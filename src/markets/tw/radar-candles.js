import {riskDetailContent} from './risk-detail.js?v=20261005-weeklist4';
import {savedResearch} from './research-data.js?v=20261001-twhome1';
import { twProvider } from "./api.js?v=20261005-recovery20";
import { renderTWCurrentCandle } from "./radar-card.js";

const cache = new Map();
const pending = new Map();
let observer;
let generation = 0;
let inFlight = 0;
const queue = [];

export function resetTWMiniCandles() {
  generation++;
  observer?.disconnect();
}

function schedule(symbol) {
  if (cache.has(symbol)) return Promise.resolve(cache.get(symbol));
  if (pending.has(symbol)) return pending.get(symbol);
  const promise = new Promise(resolve => {
    queue.push(async () => {
      try {
        const result = await twProvider.getCandles(symbol, { interval: "1D", range: "1M", limit: 24, adjusted: false });
        const entry = { candles: result?.candles || [], error: false };
        cache.set(symbol, entry);
        resolve(entry);
      } catch {
        const entry = { candles: [], error: true };
        cache.set(symbol, entry);
        resolve(entry);
      } finally {
        pending.delete(symbol);
        inFlight--;
        pump();
      }
    });
    pump();
  });
  pending.set(symbol, promise);
  return promise;
}

function pump() {
  while (inFlight < 2 && queue.length) {
    inFlight++;
    queue.shift()();
  }
}

function paintMini(node, entry) {
  const chart = renderTWCurrentCandle(entry.candles);
  node.innerHTML = chart || "—";
  node.title = chart ? "最近交易日日 K · 非即時" : entry.error ? "日 K 暫時無法載入" : "日 K 尚無資料";
  node.setAttribute("aria-label", node.title);
}

export function observeTWMiniCandles(root) {
  resetTWMiniCandles();
  const current = generation;
  const nodes = root.querySelectorAll("[data-twr-mini]");
  if (!nodes.length) return;
  observer = new IntersectionObserver(entries => {
    for (const entry of entries) {
      if (!entry.isIntersecting) continue;
      observer.unobserve(entry.target);
      const node = entry.target;
      const symbol = node.dataset.twrMini;
      if (cache.has(symbol)) paintMini(node, cache.get(symbol));
      else schedule(symbol).then(result => {
        if (current === generation && node.isConnected) paintMini(node, result);
      });
    }
  }, { rootMargin: "120px" });
  nodes.forEach(node => observer.observe(node));
}

export function openTWStockDetail(root,row){
 if(!row)return;document.querySelector('.tw-stock-detail')?.close();document.querySelector('.tw-stock-detail')?.remove();
 const scrollY=window.scrollY,dialog=document.createElement('dialog');
 dialog.className='tw-stock-detail';dialog.setAttribute('aria-label',`${row.name||row.symbol} 風險與處置資訊`);
 dialog.innerHTML='<section class="tw-stock-detail-panel">'+riskDetailContent(row,savedResearch())+'</section>';
 document.body.append(dialog);dialog.showModal();
 const close=()=>{dialog.close();dialog.remove();window.scrollTo(0,scrollY);root.querySelector(`[data-twr-symbol="${CSS.escape(row.symbol)}"]`)?.focus({preventScroll:true});};
 dialog.addEventListener('cancel',event=>{event.preventDefault();close();});
 dialog.addEventListener('click',event=>{if(event.target===dialog||event.target.closest('[data-twr-close]'))close();else if(event.target.closest('[data-twr-chart]')){close();document.querySelector('.dock-btn[data-view-target="radar"]')?.click();document.dispatchEvent(new CustomEvent('ox:tw-chart-symbol',{detail:{symbol:row.symbol}}));}});
 dialog.querySelector('[data-twr-close]')?.focus({preventScroll:true});dialog.classList.add('visible');
}
