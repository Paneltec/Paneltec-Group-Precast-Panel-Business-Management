"""AI Compliance Standards Check — Phase 11.6.

Runs a real pipeline:
  1. Tavily web search per selected standard (scoped to AU authorities)
  2. Aggregates snippets + URLs into a bounded context bundle
  3. LLM call to the active text provider (OpenAI / Anthropic / Google)
  4. Persists result as a new draft template — never overwrites the source

Region is hard-locked to Tasmania, Australia.
"""
from __future__ import annotations

import json
import logging
import re
import time
import uuid
from collections import defaultdict, deque
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional, Tuple

import httpx

logger = logging.getLogger("paneltec.ai_compliance")

REGION_LABEL = "Tasmania, Australia"
AU_STANDARDS_DOMAINS = ["standards.org.au", "abcb.gov.au", "worksafe.tas.gov.au",
                         "cbos.tas.gov.au", "legislation.tas.gov.au"]
CONTEXT_TOKEN_BUDGET = 30_000
_APPROX_CHARS_PER_TOKEN = 4  # rough heuristic — good enough for cap enforcement

# In-memory sliding-window rate limiter keyed by user id.
_RATE_WINDOW_SECONDS = 3600
_RATE_MAX = 5
_rate_hits: Dict[str, deque] = defaultdict(deque)


def check_rate_limit(user_id: str) -> Tuple[bool, int]:
    now = time.time()
    hits = _rate_hits[user_id]
    while hits and hits[0] < now - _RATE_WINDOW_SECONDS:
        hits.popleft()
    if len(hits) >= _RATE_MAX:
        return False, _RATE_MAX - len(hits)
    hits.append(now)
    return True, _RATE_MAX - len(hits)


# --------------------- Step 1: Tavily search ---------------------
async def tavily_search(api_key: str, query: str, max_results: int = 5) -> Dict[str, Any]:
    """Return {"ok": bool, "results": [...], "error": str}.
    Uses Tavily's `include_domains` array (site: operators + `country` field
    caused HTTP 400 previously)."""
    if not api_key:
        return {"ok": False, "results": [], "error": "Missing Tavily API key"}
    payload = {"api_key": api_key, "query": query,
                "search_depth": "advanced", "max_results": max_results,
                "include_answer": False,
                "include_domains": AU_STANDARDS_DOMAINS}
    try:
        async with httpx.AsyncClient(timeout=20.0) as c:
            r = await c.post("https://api.tavily.com/search", json=payload)
        if r.status_code != 200:
            snippet = (r.text or "")[:200]
            logger.warning("Tavily HTTP %s — %s", r.status_code, snippet)
            return {"ok": False, "results": [], "error": f"Tavily HTTP {r.status_code}: {snippet}"}
        return {"ok": True, "results": (r.json() or {}).get("results", []), "error": ""}
    except httpx.HTTPError as e:
        return {"ok": False, "results": [], "error": f"Tavily unreachable ({type(e).__name__})"}


async def tavily_verify(api_key: str) -> Dict[str, Any]:
    try:
        async with httpx.AsyncClient(timeout=15.0) as c:
            r = await c.post("https://api.tavily.com/search",
                              json={"api_key": api_key, "query": "test",
                                    "max_results": 1})
        if r.status_code == 200:
            return {"ok": True, "status": "CONNECTED", "message": "Tavily OK"}
        return {"ok": False, "status": "ERROR", "message": f"Tavily HTTP {r.status_code}"}
    except httpx.HTTPError as e:
        return {"ok": False, "status": "ERROR", "message": f"Tavily unreachable ({type(e).__name__})"}


async def gather_sources(api_key: str, standards: List[str],
                          template_keywords: str) -> Tuple[List[Dict[str, Any]], Optional[str]]:
    """Gather Tavily snippets for every selected standard. Returns
    (sources, error) where `error` is None on success. If EVERY per-standard
    call errored, returns (empty, first error message) so the endpoint can
    surface a useful 502 instead of silently continuing with 0 context."""
    out: List[Dict[str, Any]] = []
    first_error: Optional[str] = None
    ok_calls = 0
    for std in standards:
        q = f"{std} {template_keywords} Tasmania precast concrete"
        res = await tavily_search(api_key, q, max_results=5)
        if not res.get("ok"):
            if first_error is None:
                first_error = res.get("error") or "Tavily error"
            continue
        ok_calls += 1
        for r in res.get("results") or []:
            out.append({
                "standard": std,
                "title": (r.get("title") or "")[:200],
                "url": r.get("url") or "",
                "snippet": (r.get("content") or "")[:800],
                "score": r.get("score") or 0.0,
            })
    # Sort by score desc, then trim to ~30k tokens worth of chars
    out.sort(key=lambda x: x["score"], reverse=True)
    trimmed: List[Dict[str, Any]] = []
    running_chars = 0
    for e in out:
        entry_chars = len(e["snippet"]) + len(e["title"]) + len(e["url"])
        if running_chars + entry_chars > CONTEXT_TOKEN_BUDGET * _APPROX_CHARS_PER_TOKEN:
            break
        trimmed.append(e); running_chars += entry_chars
    # If every search errored, propagate the failure
    if ok_calls == 0 and first_error:
        return trimmed, first_error
    return trimmed, None


# --------------------- Step 2: LLM call ---------------------
def _build_prompt(mode: str, template_type: Optional[str],
                   template: Optional[Dict[str, Any]],
                   standards: List[str],
                   sources: List[Dict[str, Any]]) -> str:
    standards_line = "; ".join(standards)
    sources_text = "\n".join(
        f"[{i+1}] {s['standard']} — {s['title']}\nURL: {s['url']}\n{s['snippet']}"
        for i, s in enumerate(sources)
    )
    intro = (
        f"You are a construction compliance auditor for precast concrete works "
        f"in {REGION_LABEL}. Standards in scope: {standards_line}."
    )
    if mode == "update":
        tpl_json = json.dumps(template or {}, indent=2)[:15000]
        instruction = (
            "Compare the CURRENT TEMPLATE against the STANDARDS EXCERPTS. "
            "For each divergence output a JSON change entry with fields: "
            '{"id":"c1","section":"section_name","field_id":"…","change_type":"add|remove|modify",'
            '"before":"…","after":"…","rationale":"…",'
            '"citation":{"standard":"AS 3850.1:2015","clause":"§7.3.2","source_url":"https://…"}}. '
            "Return valid JSON of shape "
            '{"summary":"…","changes":[…]}. '
            "Every change MUST include a citation with a source_url pulled from the excerpts. "
            "Do NOT invent clauses. If no changes needed, return empty changes list."
        )
        body = f"=== CURRENT TEMPLATE ===\n{tpl_json}\n"
    else:
        instruction = (
            f"Generate a comprehensive {template_type or 'Custom'} compliance form template "
            f"for {REGION_LABEL} precast works. Return valid JSON of shape "
            '{"summary":"…","template":{"code":"…","name":"…","description":"…","category":"…",'
            '"sections":[{"key":"…","title":"…","criteria":[{"key":"…","label":"…",'
            '"input_type":"yes_no|text|number|date|checkbox|signature",'
            '"required":true,"allow_photo":false,"citation":{"standard":"…","clause":"…","source_url":"…"}}]}],'
            '"header_fields":[],"signoff_stages":[]},"changes":[]}. '
            "Every criterion MUST include a citation drawn from the excerpts. "
            "Do NOT invent clauses."
        )
        body = ""
    return f"{intro}\n\n{instruction}\n\n{body}=== STANDARDS EXCERPTS ===\n{sources_text}\n=== END ===\nReturn valid JSON only, no prose."


async def call_openai(api_key: str, prompt: str) -> Dict[str, Any]:
    try:
        async with httpx.AsyncClient(timeout=90.0) as c:
            r = await c.post("https://api.openai.com/v1/chat/completions",
                              headers={"Authorization": f"Bearer {api_key}",
                                       "Content-Type": "application/json"},
                              json={"model": "gpt-4o-mini",
                                    "messages": [
                                        {"role":"system","content":"Return valid JSON only."},
                                        {"role":"user","content":prompt}],
                                    "response_format": {"type":"json_object"},
                                    "temperature": 0.2})
        if r.status_code != 200:
            return {"ok": False, "error": f"OpenAI HTTP {r.status_code}: {r.text[:200]}"}
        body = r.json()
        content = body["choices"][0]["message"]["content"]
        usage = body.get("usage", {})
        return {"ok": True, "content": content, "model": "gpt-4o-mini",
                "prompt_tokens": usage.get("prompt_tokens", 0),
                "completion_tokens": usage.get("completion_tokens", 0)}
    except Exception as e:
        return {"ok": False, "error": f"OpenAI call failed: {type(e).__name__}: {e}"}


async def call_anthropic(api_key: str, prompt: str) -> Dict[str, Any]:
    try:
        async with httpx.AsyncClient(timeout=90.0) as c:
            r = await c.post("https://api.anthropic.com/v1/messages",
                              headers={"x-api-key": api_key,
                                       "anthropic-version":"2023-06-01",
                                       "Content-Type":"application/json"},
                              json={"model": "claude-3-5-sonnet-latest",
                                    "max_tokens": 4096,
                                    "messages": [{"role":"user","content":prompt}],
                                    "system": "Return valid JSON only. No prose outside the JSON."})
        if r.status_code != 200:
            return {"ok": False, "error": f"Anthropic HTTP {r.status_code}: {r.text[:200]}"}
        body = r.json()
        content = "".join(b.get("text","") for b in body.get("content",[]) if b.get("type") == "text")
        usage = body.get("usage", {})
        return {"ok": True, "content": content, "model": body.get("model",""),
                "prompt_tokens": usage.get("input_tokens", 0),
                "completion_tokens": usage.get("output_tokens", 0)}
    except Exception as e:
        return {"ok": False, "error": f"Anthropic call failed: {type(e).__name__}: {e}"}


async def call_google(api_key: str, prompt: str) -> Dict[str, Any]:
    try:
        async with httpx.AsyncClient(timeout=90.0) as c:
            r = await c.post(f"https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key={api_key}",
                              json={"contents":[{"parts":[{"text": prompt}]}],
                                    "generationConfig":{"responseMimeType":"application/json","temperature":0.2}})
        if r.status_code != 200:
            return {"ok": False, "error": f"Google HTTP {r.status_code}: {r.text[:200]}"}
        body = r.json()
        cand = (body.get("candidates") or [{}])[0]
        parts = (cand.get("content") or {}).get("parts") or []
        content = "".join(p.get("text","") for p in parts)
        um = body.get("usageMetadata", {})
        return {"ok": True, "content": content, "model": "gemini-1.5-flash",
                "prompt_tokens": um.get("promptTokenCount", 0),
                "completion_tokens": um.get("candidatesTokenCount", 0)}
    except Exception as e:
        return {"ok": False, "error": f"Google call failed: {type(e).__name__}: {e}"}


async def call_llm(provider: str, api_key: str, prompt: str) -> Dict[str, Any]:
    if provider == "openai":    return await call_openai(api_key, prompt)
    if provider == "anthropic": return await call_anthropic(api_key, prompt)
    if provider == "google":    return await call_google(api_key, prompt)
    return {"ok": False, "error": f"Unsupported text provider '{provider}'"}


def _extract_json(text: str) -> Optional[Dict[str, Any]]:
    if not text: return None
    text = text.strip()
    # Strip common code-fence wrappers
    if text.startswith("```"):
        text = re.sub(r"^```(?:json)?\s*", "", text)
        text = re.sub(r"\s*```$", "", text)
    try: return json.loads(text)
    except Exception:
        # Try to locate the outermost JSON object
        m = re.search(r"\{[\s\S]*\}", text)
        if m:
            try: return json.loads(m.group(0))
            except Exception: return None
        return None


def filter_cited_changes(changes: List[Dict[str, Any]]) -> Tuple[List[Dict[str, Any]], int]:
    """Return (kept, dropped_count) — drops any change without a citation.source_url."""
    kept = []
    dropped = 0
    for c in changes or []:
        cit = c.get("citation") or {}
        if not cit.get("source_url"):
            dropped += 1; continue
        # ensure a stable id
        c.setdefault("id", f"c{uuid.uuid4().hex[:8]}")
        kept.append(c)
    return kept, dropped


def filter_cited_template(tpl: Optional[Dict[str, Any]]) -> Tuple[Optional[Dict[str, Any]], int]:
    """For generate-mode: drop criteria without a citation.source_url."""
    if not isinstance(tpl, dict): return tpl, 0
    dropped = 0
    for sec in tpl.get("sections", []) or []:
        kept = []
        for c in sec.get("criteria", []) or []:
            cit = c.get("citation") or {}
            if not cit.get("source_url"):
                dropped += 1; continue
            kept.append(c)
        sec["criteria"] = kept
    return tpl, dropped
