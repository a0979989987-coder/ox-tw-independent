process.env.SITE_BASE_PATH='/'+(process.env.GITHUB_REPOSITORY?.split('/')[1]||'ox-tw-independent');
process.env.TW_API_BASE||='https://ox-tw-independent.btcfly.chatgpt.site/api';
await import('./build.mjs');
