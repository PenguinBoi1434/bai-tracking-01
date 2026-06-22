import "./AuthBranding.css";

/**
 * Custom Header (logo) and Footer (company info) for the Amplify Authenticator
 * login window. Pass as the `components` prop to <Authenticator>.
 */
export const authComponents = {
  Header() {
    return (
      <div className="auth-brand-header">
        <img
          src="/app-display-logo.png"
          alt="Bai Engineers"
          className="auth-brand-logo"
          onError={(e) => {
            // If the logo file isn't present yet, show a text wordmark instead
            // of a broken-image icon.
            e.currentTarget.style.display = "none";
            const fallback = e.currentTarget
              .nextElementSibling as HTMLElement | null;
            if (fallback) fallback.style.display = "block";
          }}
        />
        <span className="auth-brand-wordmark" style={{ display: "none" }}>
          BAI ENGINEERS
        </span>
      </div>
    );
  },

  Footer() {
    return (
      <div className="auth-brand-footer">
        <p className="auth-brand-name">Bai Engineers, LLC</p>
        <p>Phone: (720) 474-0941</p>
        <p>
          Email: <a href="mailto:xbai@bai-eng.com">xbai@bai-eng.com</a>
        </p>
        <p>
          Website:{" "}
          <a href="https://www.bai-eng.com" target="_blank" rel="noreferrer">
            www.bai-eng.com
          </a>
        </p>
        <p className="auth-brand-address">
          Main Office: 5350 DTC Pkwy, #206
          <br />
          Greenwood Village, CO 80111
        </p>
      </div>
    );
  },
};
