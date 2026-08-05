import { forwardRef, useState } from "react";
import { Eye, EyeOff } from "lucide-react";
import { Input } from "./ui/input";

/**
 * Password input with a show/hide eye toggle pinned to the right edge.
 * Absolute-positioned button — no layout shift on toggle.
 * Forwards all other props to the underlying <Input>.
 */
const PasswordInput = forwardRef(function PasswordInput(
  { className = "", testIdSuffix = "", ...rest },
  ref
) {
  const [visible, setVisible] = useState(false);
  const Icon = visible ? EyeOff : Eye;
  const toggleTestId = testIdSuffix
    ? `password-toggle-${testIdSuffix}`
    : "password-toggle";
  return (
    <div className="relative">
      <Input
        ref={ref}
        {...rest}
        type={visible ? "text" : "password"}
        className={`pr-10 ${className}`}
      />
      <button
        type="button"
        onClick={() => setVisible((v) => !v)}
        aria-label={visible ? "Hide password" : "Show password"}
        title={visible ? "Hide password" : "Show password"}
        tabIndex={0}
        data-testid={toggleTestId}
        className="absolute inset-y-0 right-0 flex items-center justify-center px-3 text-gray-500 hover:text-[#1F2A33] focus:outline-none focus-visible:ring-2 focus-visible:ring-[#F5C518] focus-visible:ring-offset-1 rounded"
      >
        <Icon className="w-4 h-4" aria-hidden="true" />
      </button>
    </div>
  );
});

export default PasswordInput;
