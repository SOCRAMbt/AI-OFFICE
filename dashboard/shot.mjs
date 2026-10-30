/* Verificación visual del dashboard (Impeccable: screenshot + defect scan) */
import { chromium } from "playwright";

const URL = "http://localhost:7333";
const out = "dashboard/shots";

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });

const errors = [];
page.on("pageerror", (e) => errors.push("pageerror: " + e.message));
page.on("console", (m) => { if (m.type() === "error") errors.push("console: " + m.text()); });

await page.goto(URL, { waitUntil: "networkidle" });
await page.waitForTimeout(2000);

// 1. vista desktop con datos reales
await page.screenshot({ path: `${out}/desktop-real.png`, fullPage: true });

// 2. click en una card → gates render
await page.click(".card >> nth=0");
await page.waitForTimeout(800);
await page.screenshot({ path: `${out}/desktop-gates.png` });

// 3. móvil 390x844
await page.setViewportSize({ width: 390, height: 844 });
await page.waitForTimeout(600);
await page.screenshot({ path: `${out}/mobile.png`, fullPage: true });

// 4. tema claro
await page.setViewportSize({ width: 1440, height: 900 });
await page.keyboard.press("t");
await page.waitForTimeout(600);
await page.screenshot({ path: `${out}/desktop-light.png` });

// 5. sin errores JS
console.log("errores JS:", errors.length ? errors : "ninguno");

// 6. checks de contenido
const checks = await page.evaluate(() => {
  const $ = (s) => document.querySelector(s);
  return {
    runId: $("#run-id")?.textContent,
    mesaNodes: document.querySelectorAll(".agent-node").length,
    busMsgs: document.querySelectorAll(".msg").length,
    boardCols: document.querySelectorAll(".col").length,
    chiefItems: document.querySelectorAll(".chief-item").length,
    demoBanner: !$("#demo-banner")?.hidden,
    conn: $("#conn")?.dataset.state,
  };
});
console.log("checks:", JSON.stringify(checks, null, 2));

await browser.close();
