"""OAuth dönüş sayfaları: tarayıcıda görünen başarı/hata ekranı CyberGoose tasarımıyla.

Google Drive (yerel yönlendirme sunucusu) ve Dropbox (/oauth2/callback) aynı sayfayı kullanır.
Sayfa tamamen satır içidir (dış kaynak, betik yok); renkler tasarım token'larından gelir ve
sistem temasına (koyu/açık) uyar.
"""

from html import escape

PAGE_HEADERS = {
    "Content-Type": "text/html; charset=utf-8",
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
    "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'; img-src data:",
    "Referrer-Policy": "no-referrer",
}

_LOGO = (
    '<svg class="logo" viewBox="0 0 824 824" aria-hidden="true">'
    '<rect width="824" height="824" rx="183" fill="#16181B"/>'
    '<g transform="scale(3.21875) translate(6 0)">'
    '<path fill="#F2EFE8" fill-rule="evenodd" d="M78 300V120A58 58 0 0 1 136 62H162V106H136A14 14 0 0 0 122 120V300ZM138 76V86H148V76Z"/>'
    '<path fill="#FF6A1F" d="M162 62H178L200 84L178 106H162Z"/>'
    "</g></svg>"
)

_ICON_OK = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12.5l4.2 4.2L19 7" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/></svg>'
_ICON_ERROR = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 7l10 10M17 7L7 17" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"/></svg>'

_STYLE = """
:root{color-scheme:dark;--bg-app:#0f1113;--bg-pane:#17191c;--bg-raised:#1e2124;--line:#2b2e33;--text:#eceae4;
--text-muted:#9ea2a9;--beak:#ff6a1f;--ok:#4cc26f;--ok-soft:#18301f;--error:#ff6b5a;--error-soft:#3a1e1b;
--shadow:0 0 0 1px #2b2e33,0 8px 24px rgba(0,0,0,.5)}
@media (prefers-color-scheme:light){:root{color-scheme:light;--bg-app:#e9e6df;--bg-pane:#faf9f6;--bg-raised:#f3f1ec;
--line:#dcd8cf;--text:#16181b;--text-muted:#5b5e65;--ok:#1a6e34;--ok-soft:#ddf0e2;--error:#b02c1a;--error-soft:#fbe3de;
--shadow:0 0 0 1px #dcd8cf,0 8px 24px rgba(22,24,27,.14)}}
*{box-sizing:border-box}
html,body{margin:0;height:100%}
body{display:grid;place-items:center;padding:24px;background:var(--bg-app);color:var(--text);
font:14px/20px "IBM Plex Sans","Segoe UI",system-ui,-apple-system,sans-serif;-webkit-font-smoothing:antialiased}
body::before{content:"";position:fixed;inset:0 0 auto;height:3px;background:var(--beak)}
main{width:100%;max-width:440px;background:var(--bg-pane);border-radius:12px;box-shadow:var(--shadow);overflow:hidden}
header{display:flex;align-items:center;gap:10px;padding:14px 20px;border-bottom:1px solid var(--line);background:var(--bg-raised)}
.logo{width:28px;height:28px;flex:none}
.brand{font-weight:600;letter-spacing:.01em}
.provider{margin-left:auto;font:12px/16px "IBM Plex Mono",ui-monospace,Consolas,monospace;color:var(--text-muted);
padding:2px 8px;border:1px solid var(--line);border-radius:999px}
section{padding:28px 24px 24px;text-align:center}
.status{width:56px;height:56px;margin:0 auto 16px;border-radius:50%;display:grid;place-items:center}
.status svg{width:28px;height:28px}
.ok .status{background:var(--ok-soft);color:var(--ok)}
.error .status{background:var(--error-soft);color:var(--error)}
h1{margin:0 0 8px;font-size:20px;line-height:28px;font-weight:600}
p{margin:0;color:var(--text-muted)}
.detail{margin-top:16px;padding:10px 12px;border-radius:8px;background:var(--error-soft);color:var(--text);
font:12px/18px "IBM Plex Mono",ui-monospace,Consolas,monospace;text-align:left;overflow-wrap:anywhere}
footer{padding:12px 24px;border-top:1px solid var(--line);font-size:12px;line-height:16px;color:var(--text-muted);text-align:center}
kbd{font:inherit;font-family:"IBM Plex Mono",ui-monospace,Consolas,monospace;padding:1px 5px;border:1px solid var(--line);border-radius:4px;background:var(--bg-raised)}
"""


def render_oauth_page(provider: str, ok: bool, message: str = "", detail: str = "") -> str:
    """Başarı ya da hata sayfası. Tüm metinler HTML'e kaçışlanarak yerleştirilir."""
    provider_text = escape(provider)
    if ok:
        title = f"{provider_text} bağlantısı tamamlandı"
        body = escape(message or "Bu sekmeyi kapatıp CyberGoose'a dönebilirsiniz.")
        footer = "Bu sekmeyi kapatabilirsiniz <kbd>Ctrl</kbd> + <kbd>W</kbd>"
    else:
        title = f"{provider_text} bağlantısı kurulamadı"
        body = escape(message or "CyberGoose'a dönüp bağlanmayı tekrar deneyin.")
        footer = "CyberGoose'a dönüp tekrar deneyin"
    detail_html = f'<div class="detail">{escape(detail)}</div>' if detail and not ok else ""
    return (
        '<!doctype html><html lang="tr"><head><meta charset="utf-8">'
        '<meta name="viewport" content="width=device-width,initial-scale=1">'
        f"<title>{title} · CyberGoose</title><style>{_STYLE}</style></head>"
        f'<body><main class="{"ok" if ok else "error"}">'
        f'<header>{_LOGO}<span class="brand">CyberGoose</span><span class="provider">{provider_text}</span></header>'
        f'<section role="{"status" if ok else "alert"}"><div class="status">{_ICON_OK if ok else _ICON_ERROR}</div>'
        f"<h1>{title}</h1><p>{body}</p>{detail_html}</section>"
        f"<footer>{footer}</footer></main></body></html>"
    )
