/* Sonda 2: .app y sus hijos */
import { chromium } from "playwright";

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
await page.goto("http://localhost:7333", { waitUntil: "networkidle" });
await page.waitForTimeout(1500);

const probe = await page.evaluate(() => {
  const info = (el) => {
    const r = el.getBoundingClientRect();
    const cs = getComputedStyle(el);
    return {
      sel: el.tagName.toLowerCase() + (el.id ? "#" + el.id : "") + (el.className && typeof el.className === "string" ? "." + el.className.split(" ")[0] : ""),
      w: Math.round(r.width),
      scrollW: el.scrollWidth,
      minW: cs.minWidth,
      display: cs.display,
      overflowX: cs.overflowX,
    };
  };
  const app = document.querySelector(".app");
  const out = { app: info(app), children: [...app.children].map(info) };
  const board = document.querySelector(".board");
  const bsec = document.querySelector(".board-section");
  out.board = board ? info(board) : null;
  out.boardCols = board ? [...board.children].map(info) : null;
  out.boardSection = bsec ? info(bsec) : null;
  const main = document.querySelector(".main");
  out.main = main ? info(main) : null;
  out.mainPanels = main ? [...main.children].map(info) : null;
  return out;
});
console.log(JSON.stringify(probe, null, 2));
await browser.close();
