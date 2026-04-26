import { useState } from "react";

export default function PasswordField({ label, value, onChange, required = false, minLength, autoComplete }) {
  const [visible, setVisible] = useState(false);

  return (
    <label>
      {label}
      <span className="password-field">
        <input
          type={visible ? "text" : "password"}
          value={value}
          onChange={onChange}
          required={required}
          minLength={minLength}
          autoComplete={autoComplete}
        />
        <button
          type="button"
          className="password-toggle"
          onClick={() => setVisible((current) => !current)}
          aria-label={visible ? `Hide ${label.toLowerCase()}` : `Show ${label.toLowerCase()}`}
          aria-pressed={visible}
          title={visible ? "Hide password" : "Show password"}
        >
          <span className={`eye-icon${visible ? " visible" : ""}`} aria-hidden="true" />
        </button>
      </span>
    </label>
  );
}
