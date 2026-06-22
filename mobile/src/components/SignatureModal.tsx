import React, { useRef, useState } from 'react';
import {
  View, Text, TouchableOpacity, StyleSheet, Modal,
  ActivityIndicator, Platform,
} from 'react-native';
import { Colors } from '../lib/colors';

/**
 * SignatureModal — full-screen modal with a drawing canvas.
 * Uses react-native-signature-canvas on native platforms,
 * fallback HTML5 Canvas on web.
 */
export default function SignatureModal({ visible, onClose, onConfirm, signerName }: {
  visible: boolean;
  onClose: () => void;
  onConfirm: (base64Png: string) => void;
  signerName?: string;
}) {
  const [submitting, setSubmitting] = useState(false);

  if (Platform.OS === 'web') {
    return (
      <WebSignatureModal
        visible={visible}
        onClose={onClose}
        onConfirm={onConfirm}
        signerName={signerName}
        submitting={submitting}
        setSubmitting={setSubmitting}
      />
    );
  }

  return (
    <NativeSignatureModal
      visible={visible}
      onClose={onClose}
      onConfirm={onConfirm}
      signerName={signerName}
      submitting={submitting}
      setSubmitting={setSubmitting}
    />
  );
}

/* ---- Native implementation (react-native-signature-canvas) ---- */
function NativeSignatureModal({ visible, onClose, onConfirm, signerName, submitting, setSubmitting }: any) {
  let SignatureScreen: any = null;
  try {
    SignatureScreen = require('react-native-signature-canvas').default;
  } catch {
    // Fallback if import fails
  }

  const sigRef = useRef<any>(null);

  const handleConfirm = async (sig: string) => {
    if (!sig || sig === 'data:,') return;
    setSubmitting(true);
    await onConfirm(sig);
    setSubmitting(false);
  };

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose}>
      <View style={styles.container} testID="signature-modal">
        <View style={styles.header}>
          <TouchableOpacity onPress={onClose} testID="sig-cancel">
            <Text style={styles.cancelText}>Cancel</Text>
          </TouchableOpacity>
          <View style={{ flex: 1, alignItems: 'center' }}>
            <Text style={styles.title}>QA Sign-off</Text>
            {signerName ? <Text style={styles.signer}>Signing as {signerName}</Text> : null}
          </View>
          <TouchableOpacity
            testID="sig-clear"
            onPress={() => sigRef.current?.clearSignature()}
          >
            <Text style={styles.clearText}>Clear</Text>
          </TouchableOpacity>
        </View>

        <View style={styles.canvasWrap}>
          {SignatureScreen ? (
            <SignatureScreen
              ref={sigRef}
              onOK={handleConfirm}
              onEmpty={() => {}}
              descriptionText=""
              webStyle={`
                .m-signature-pad { box-shadow: none; border: 2px solid #D1D5DB; border-radius: 8px; }
                .m-signature-pad--body { border: none; }
                .m-signature-pad--footer { display: none; }
                body,html { width: 100%; height: 100%; }
              `}
              backgroundColor="#FFFFFF"
              penColor="#1F2A33"
              minWidth={2}
              maxWidth={4}
            />
          ) : (
            <View style={styles.fallback}>
              <Text style={styles.fallbackText}>Signature canvas not available</Text>
            </View>
          )}
        </View>

        <View style={styles.footer}>
          <TouchableOpacity
            testID="sig-confirm"
            style={[styles.confirmBtn, submitting && { opacity: 0.5 }]}
            onPress={() => sigRef.current?.readSignature()}
            disabled={submitting}
          >
            {submitting ? (
              <ActivityIndicator color="#FFF" size="small" />
            ) : (
              <Text style={styles.confirmText}>Confirm & Sign</Text>
            )}
          </TouchableOpacity>
        </View>
      </View>
    </Modal>
  );
}

/* ---- Web fallback (HTML5 Canvas) ---- */
function WebSignatureModal({ visible, onClose, onConfirm, signerName, submitting, setSubmitting }: any) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const drawingRef = useRef(false);

  if (!visible) return null;

  const getCtx = () => canvasRef.current?.getContext('2d');

  const startDraw = (e: any) => {
    const ctx = getCtx();
    if (!ctx) return;
    drawingRef.current = true;
    const rect = canvasRef.current!.getBoundingClientRect();
    const clientX = e.touches ? e.touches[0].clientX : e.clientX;
    const clientY = e.touches ? e.touches[0].clientY : e.clientY;
    ctx.beginPath();
    ctx.moveTo(clientX - rect.left, clientY - rect.top);
  };

  const draw = (e: any) => {
    if (!drawingRef.current) return;
    const ctx = getCtx();
    if (!ctx) return;
    const rect = canvasRef.current!.getBoundingClientRect();
    const clientX = e.touches ? e.touches[0].clientX : e.clientX;
    const clientY = e.touches ? e.touches[0].clientY : e.clientY;
    ctx.lineTo(clientX - rect.left, clientY - rect.top);
    ctx.strokeStyle = '#1F2A33';
    ctx.lineWidth = 3;
    ctx.lineCap = 'round';
    ctx.stroke();
  };

  const endDraw = () => { drawingRef.current = false; };

  const clear = () => {
    const ctx = getCtx();
    if (ctx && canvasRef.current) {
      ctx.clearRect(0, 0, canvasRef.current.width, canvasRef.current.height);
    }
  };

  const confirm = async () => {
    if (!canvasRef.current) return;
    const dataUrl = canvasRef.current.toDataURL('image/png');
    if (!dataUrl || dataUrl === 'data:,') return;
    setSubmitting(true);
    await onConfirm(dataUrl);
    setSubmitting(false);
  };

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <View style={styles.container} testID="signature-modal">
        <View style={styles.header}>
          <TouchableOpacity onPress={onClose} testID="sig-cancel">
            <Text style={styles.cancelText}>Cancel</Text>
          </TouchableOpacity>
          <View style={{ flex: 1, alignItems: 'center' }}>
            <Text style={styles.title}>QA Sign-off</Text>
            {signerName ? <Text style={styles.signer}>Signing as {signerName}</Text> : null}
          </View>
          <TouchableOpacity testID="sig-clear" onPress={clear}>
            <Text style={styles.clearText}>Clear</Text>
          </TouchableOpacity>
        </View>

        <View style={styles.canvasWrap}>
          <canvas
            ref={(el: any) => { canvasRef.current = el; }}
            width={600}
            height={250}
            style={{ width: '100%', maxWidth: 600, height: 250, border: '2px solid #D1D5DB', borderRadius: 8, background: '#FFF', touchAction: 'none', cursor: 'crosshair' } as any}
            onMouseDown={startDraw}
            onMouseMove={draw}
            onMouseUp={endDraw}
            onMouseLeave={endDraw}
            onTouchStart={startDraw}
            onTouchMove={draw}
            onTouchEnd={endDraw}
          />
          <Text style={styles.hint}>Draw your signature above</Text>
        </View>

        <View style={styles.footer}>
          <TouchableOpacity
            testID="sig-confirm"
            style={[styles.confirmBtn, submitting && { opacity: 0.5 }]}
            onPress={confirm}
            disabled={submitting}
          >
            {submitting ? (
              <ActivityIndicator color="#FFF" size="small" />
            ) : (
              <Text style={styles.confirmText}>Confirm & Sign</Text>
            )}
          </TouchableOpacity>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 16,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
    backgroundColor: Colors.surface,
  },
  title: { fontSize: 17, fontWeight: '800', color: Colors.charcoal },
  signer: { fontSize: 12, color: Colors.textSecondary, marginTop: 2 },
  cancelText: { fontSize: 14, fontWeight: '600', color: Colors.steelBlue },
  clearText: { fontSize: 14, fontWeight: '600', color: '#DC2626' },
  canvasWrap: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
  },
  hint: { fontSize: 12, color: Colors.textMuted, marginTop: 8 },
  fallback: {
    width: '100%',
    height: 250,
    backgroundColor: '#F3F4F6',
    borderRadius: 8,
    borderWidth: 2,
    borderColor: Colors.border,
    justifyContent: 'center',
    alignItems: 'center',
  },
  fallbackText: { fontSize: 14, color: Colors.textMuted },
  footer: {
    padding: 16,
    borderTopWidth: 1,
    borderTopColor: Colors.border,
    backgroundColor: Colors.surface,
  },
  confirmBtn: {
    backgroundColor: '#166534',
    paddingVertical: 16,
    borderRadius: 8,
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'center',
    gap: 8,
  },
  confirmText: { fontSize: 16, fontWeight: '800', color: '#FFF' },
});
