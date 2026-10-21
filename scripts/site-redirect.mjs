// The public address is GitHub Pages; the Sites deployment serves the API.
// Its page forwards visitors before anything else loads, keeping the query and
// hash. A refresh covers browsers without scripts. A local preview stays put so
// the built site can still be tested on this machine.
export const PAGES_URL = 'https://a0979989987-coder.github.io/ox-tw-independent/';

export const redirectScript = `(function(){var h=location.hostname;if(h==='localhost'||h==='127.0.0.1'||h==='[::1]'||/\\.localhost$/.test(h))return;location.replace(${JSON.stringify(PAGES_URL)}+location.search+location.hash);})();`;

export function withPagesRedirect(html) {
  if (!html.includes('<head>')) throw Error('index.html has no <head>');
  return html.replace('<head>', `<head><script data-ox-pages-redirect>${redirectScript}</script><noscript><meta http-equiv="refresh" content="0; url=${PAGES_URL}"></noscript>`);
}
