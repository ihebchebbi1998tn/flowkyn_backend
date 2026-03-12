/**
 * Shared email layout wrapper — consistent branding across all emails.
 */

export interface LayoutData {
  /** Main content HTML */
  content: string;
  /** Footer text */
  footerText: string;
  /** Preview text (shows in email client list) */
  previewText?: string;
}

/**
 * Wrap email content in a professional branded layout.
 */
export function emailLayout(data: LayoutData): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <meta http-equiv="X-UA-Compatible" content="IE=edge" />
  <title>Flowkyn</title>
  <!--[if mso]>
  <noscript>
    <xml>
      <o:OfficeDocumentSettings>
        <o:PixelsPerInch>96</o:PixelsPerInch>
      </o:OfficeDocumentSettings>
    </xml>
  </noscript>
  <![endif]-->
  <style>
    /* Reset */
    body, table, td { margin: 0; padding: 0; }
    img { border: 0; display: block; outline: none; text-decoration: none; }
    body {
      width: 100% !important;
      -webkit-text-size-adjust: 100%;
      -ms-text-size-adjust: 100%;
      background-color: #f4f4f7;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;
    }
    .container { max-width: 580px; margin: 0 auto; }
    .content { padding: 40px 32px; }
    .btn {
      display: inline-block;
      padding: 14px 32px;
      background-color: #7c3aed;
      color: #ffffff !important;
      text-decoration: none;
      border-radius: 8px;
      font-weight: 600;
      font-size: 15px;
      line-height: 1;
      text-align: center;
    }
    .btn:hover { background-color: #6d28d9; }
    h1 {
      color: #1a1a2e;
      font-size: 24px;
      font-weight: 700;
      line-height: 1.3;
      margin: 0 0 16px;
    }
    p {
      color: #51545e;
      font-size: 15px;
      line-height: 1.7;
      margin: 0 0 16px;
    }
    .text-muted {
      color: #a8aaaf;
      font-size: 13px;
    }
    .footer {
      text-align: center;
      padding: 24px 32px;
    }
    .divider {
      border: none;
      border-top: 1px solid #eaeaec;
      margin: 24px 0;
    }
    .feature-list {
      margin: 16px 0;
      padding: 0;
      list-style: none;
    }
    .feature-list li {
      padding: 6px 0 6px 24px;
      position: relative;
      color: #51545e;
      font-size: 14px;
    }
    .feature-list li::before {
      content: "✓";
      position: absolute;
      left: 0;
      color: #7c3aed;
      font-weight: 700;
    }
  </style>
</head>
<body>
  ${data.previewText ? `<div style="display:none;font-size:1px;color:#f4f4f7;line-height:1px;max-height:0px;max-width:0px;opacity:0;overflow:hidden;">${data.previewText}</div>` : ''}
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#f4f4f7;">
    <tr>
      <td align="center" style="padding: 32px 16px;">
        <!-- Logo -->
        <table class="container" role="presentation" cellpadding="0" cellspacing="0" style="margin-bottom:8px;">
          <tr>
            <td align="center" style="padding: 16px 0;">
              <img src="https://www.flowkyn.com/assets/logo-B300Ujwg.png" alt="Flowkyn Logo" style="height:48px;width:auto;display:block;margin:auto;" />
            </td>
          </tr>
        </table>
        <!-- Main Card -->
        <table class="container" role="presentation" cellpadding="0" cellspacing="0" style="background-color:#ffffff;border-radius:12px;box-shadow:0 2px 8px rgba(0,0,0,0.06);">
          <tr>
            <td class="content">
              ${data.content}
            </td>
          </tr>
        </table>
        <!-- Footer -->
        <table class="container" role="presentation" cellpadding="0" cellspacing="0">
          <tr>
            <td class="footer">
              <p class="text-muted" style="margin:0;">${data.footerText}</p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}
