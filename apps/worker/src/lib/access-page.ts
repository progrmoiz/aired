/**
 * The gate a visitor sees on an "only these people" page (routes/viewer.ts):
 * their email, then the 6-digit code from the email, then the page. It says
 * nothing about the page (no title, no owner, no count) and the same thing
 * whoever is asking. Served on aired's own origin with a nonce CSP, so only
 * this script runs.
 */

const MARK = `<svg viewBox="0 0 32 32" aria-hidden="true"><circle cx="9" cy="23" r="3.5" fill="currentColor"/><path d="M9 13a10 10 0 0 1 10 10M9 6a17 17 0 0 1 17 17" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round"/></svg>`;
const LOCK = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/></svg>`;
const MAIL = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="5" width="18" height="14" rx="2"/><path d="m3 7 9 6 9-6"/></svg>`;

const CSS = `
:root{color-scheme:dark;--bg:#0a0a0b;--surface:#111113;--surface-2:#18181b;--border:#222225;--border-strong:#3b3b40;--text-1:#ededef;--text-2:#a1a1a6;--text-3:#84848a;--mark:#7c6aef;--ring:rgba(124,106,239,.4);--danger:#f87171}
*{box-sizing:border-box}
html,body{height:100%}
body{margin:0;background:var(--bg);color:var(--text-1);font:14px/1.5 'Inter',-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;-webkit-font-smoothing:antialiased;display:flex;flex-direction:column}
header{padding:20px 24px}
.logo{display:inline-flex;align-items:center;gap:8px;color:var(--text-1);text-decoration:none;font-weight:500;font-size:15px}
.logo svg{width:20px;height:20px;color:var(--mark)}
main{flex:1;display:flex;align-items:center;justify-content:center;padding:24px 16px 12vh}
.card{width:100%;max-width:380px;background:var(--surface);border:1px solid var(--border);border-radius:12px;padding:28px 24px}
.icon{width:40px;height:40px;border-radius:10px;background:var(--surface-2);border:1px solid var(--border);display:flex;align-items:center;justify-content:center;margin-bottom:18px;color:var(--text-2)}
.icon svg{width:20px;height:20px}
h1{font-size:18px;font-weight:500;letter-spacing:-.01em;margin:0 0 6px}
p{margin:0;color:var(--text-2)}
.lead{margin-bottom:20px}
.lead b{color:var(--text-1);font-weight:500;word-break:break-all}
label{display:block;font-size:13px;font-weight:500;color:var(--text-2);margin-bottom:8px}
input{width:100%;height:40px;padding:0 12px;font:inherit;font-size:14px;color:var(--text-1);background:var(--bg);border:1px solid var(--border);border-radius:8px;outline:none;transition:border-color 120ms cubic-bezier(.16,1,.3,1)}
input::placeholder{color:var(--text-3)}
input:focus{border-color:var(--border-strong)}
input:focus-visible{box-shadow:0 0 0 2px var(--bg),0 0 0 4px var(--ring)}
input.code{font:500 22px/1 'JetBrains Mono',ui-monospace,Menlo,monospace;letter-spacing:.35em;text-align:center;height:52px;padding-left:.35em}
button{width:100%;height:40px;margin-top:12px;border:0;border-radius:8px;background:var(--text-1);color:var(--bg);font:inherit;font-weight:500;cursor:pointer;transition:background 120ms cubic-bezier(.16,1,.3,1)}
button:hover{background:#fff}
button:focus-visible{outline:none;box-shadow:0 0 0 2px var(--bg),0 0 0 4px var(--ring)}
button[disabled]{opacity:.55;cursor:default}
.err{color:var(--danger);font-size:13px;margin-top:10px;min-height:0}
.err:empty{display:none}
.links{display:flex;gap:16px;margin-top:16px;font-size:13px}
.links a,.links button.link{all:unset;cursor:pointer;color:var(--text-2)}
.links a:hover,.links button.link:hover{color:var(--text-1)}
.links button.link:focus-visible,.links a:focus-visible{outline:2px solid var(--ring);outline-offset:2px;border-radius:4px}
.note{margin-top:12px;font-size:12px;color:var(--text-3)}
footer{padding:16px 24px 24px;text-align:center;font-size:12px;color:var(--text-3)}
footer a{color:var(--text-2);text-decoration:none}
footer a:hover{color:var(--text-1)}
[hidden]{display:none!important}
`;

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

/** The gate's script: two small forms that post JSON to /p/<id>/access/*. */
function script(id: string): string {
  const base = JSON.stringify(`/p/${id}/access`);
  return `(function(){
var d=document,base=${base},email="";
var $=function(s){return d.getElementById(s)};
function busy(b,on,label){b.disabled=on;b.textContent=label}
async function post(path,body){var r=await fetch(base+path,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(body),credentials:"same-origin"});var j={};try{j=await r.json()}catch(e){}return{ok:r.ok,status:r.status,body:j}}
function toCode(){$("step-email").hidden=true;$("step-code").hidden=false;$("sent-to").textContent=email;$("code").value="";$("code-err").textContent="";$("code").focus()}
function toEmail(){$("step-code").hidden=true;$("step-email").hidden=false;$("email-err").textContent="";$("email").focus()}
$("email-form").addEventListener("submit",async function(e){e.preventDefault();var v=$("email").value.trim();$("email-err").textContent="";
if(!/^[^\\s@]+@[^\\s@]+\\.[^\\s@]+$/.test(v)){$("email-err").textContent="Enter your email address.";return}
var b=$("send");busy(b,true,"Sending…");
try{var r=await post("/send",{email:v});if(r.ok){email=v;toCode()}else{$("email-err").textContent=r.body.error||"Could not send a code. Try again."}}
catch(x){$("email-err").textContent="Could not send a code. Check your connection and try again."}
busy(b,false,"Send code")});
$("code-form").addEventListener("submit",async function(e){e.preventDefault();var v=$("code").value.replace(/[\\s-]/g,"");$("code-err").textContent="";
if(!/^\\d{6}$/.test(v)){$("code-err").textContent="Enter the 6 digits from the email.";return}
var b=$("open");busy(b,true,"Checking…");
try{var r=await post("/verify",{email:email,code:v});if(r.ok){busy(b,true,"Opening…");location.reload();return}$("code-err").textContent=r.body.error||"That code didn't work. Try again.";$("code").select()}
catch(x){$("code-err").textContent="Could not check the code. Check your connection and try again."}
busy(b,false,"Open page")});
$("code").addEventListener("input",function(){var v=this.value.replace(/\\D/g,"");if(v.length===6&&!$("open").disabled){$("code-form").requestSubmit()}});
$("other").addEventListener("click",toEmail);
$("resend").addEventListener("click",async function(){var b=this;b.disabled=true;$("code-err").textContent="";
try{var r=await post("/send",{email:email});$("code-err").textContent=r.ok?"":(r.body.error||"Could not send a code. Try again.");if(r.ok){$("resent").hidden=false;setTimeout(function(){$("resent").hidden=true},4000)}}catch(x){$("code-err").textContent="Could not send a code. Try again."}
setTimeout(function(){b.disabled=false},15000)});
})();`;
}

export function accessGatePage(opts: { id: string; nonce: string }): string {
  const id = esc(opts.id);
  const signIn = `/auth/login?return=${encodeURIComponent(`/p/${opts.id}`)}`;
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow">
<meta name="referrer" content="no-referrer">
<title>Private page · aired</title>
<link rel="preload" href="/fonts/inter-latin-v20.woff2" as="font" type="font/woff2" crossorigin>
<link rel="stylesheet" href="/fonts/fonts.css">
<style>${CSS}</style>
</head>
<body>
<header><a class="logo" href="/">${MARK}aired</a></header>
<main>
  <section class="card" id="step-email" aria-labelledby="h-email">
    <div class="icon">${LOCK}</div>
    <h1 id="h-email">This page is private</h1>
    <p class="lead">Only the people it was shared with can open it. Enter your email and we'll send you a code.</p>
    <form id="email-form" novalidate>
      <label for="email">Email</label>
      <input id="email" name="email" type="email" autocomplete="email" inputmode="email" placeholder="you@company.com" maxlength="254" autofocus required>
      <button id="send" type="submit">Send code</button>
      <p class="err" id="email-err" role="alert"></p>
    </form>
  </section>
  <section class="card" id="step-code" aria-labelledby="h-code" hidden>
    <div class="icon">${MAIL}</div>
    <h1 id="h-code">Check your email</h1>
    <p class="lead">If <b id="sent-to"></b> has access, we've sent a 6-digit code. It works for 10 minutes.</p>
    <form id="code-form" novalidate>
      <label for="code">Code</label>
      <input id="code" class="code" name="code" type="text" autocomplete="one-time-code" inputmode="numeric" pattern="[0-9 ]*" maxlength="7" placeholder="000000" required>
      <button id="open" type="submit">Open page</button>
      <p class="err" id="code-err" role="alert"></p>
      <p class="note" id="resent" hidden>Sent another code.</p>
    </form>
    <div class="links"><button class="link" type="button" id="other">Use a different email</button><button class="link" type="button" id="resend">Send a new code</button></div>
  </section>
</main>
<footer>Shared with <a href="/">aired</a> · <a href="${esc(signIn)}" id="owner">Sign in if this is your page</a></footer>
<script nonce="${opts.nonce}">${script(id)}</script>
</body>
</html>`;
}

/** Headers for the gate: never cached, never framed, only its own script runs. */
export function gateHeaders(nonce: string): Headers {
  return new Headers({
    "Content-Type": "text/html; charset=utf-8",
    "Content-Security-Policy": `default-src 'none'; style-src 'unsafe-inline' 'self'; font-src 'self'; script-src 'nonce-${nonce}'; connect-src 'self'; img-src 'self' data:; base-uri 'none'; form-action 'none'; frame-ancestors 'none'`,
    "Cache-Control": "private, no-store",
    "X-Robots-Tag": "noindex, nofollow",
    "X-Frame-Options": "DENY",
    "X-Content-Type-Options": "nosniff",
    "Referrer-Policy": "no-referrer",
  });
}

export function newNonce(): string {
  const b = crypto.getRandomValues(new Uint8Array(16));
  return btoa(String.fromCharCode(...b)).replace(/[^A-Za-z0-9]/g, "");
}
