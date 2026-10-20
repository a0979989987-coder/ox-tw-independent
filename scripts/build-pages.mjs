process.env.SITE_BASE_PATH='/'+(process.env.GITHUB_REPOSITORY?.split('/')[1]||'ox-tw-independent');
process.env.TW_API_BASE||='https://ox-tw-independent.btcfly.chatgpt.site/api';
// Link previews need the absolute Pages URL (the deploy workflow passes the exact one).
const [owner='a0979989987-coder',repo='ox-tw-independent']=(process.env.GITHUB_REPOSITORY||'').split('/').filter(Boolean);
process.env.SITE_URL||=`https://${owner.toLowerCase()}.github.io/${repo}`;
await import('./build.mjs');
