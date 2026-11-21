#!/usr/bin/env node
/**
 * Generate demo GIF showing the red→green gate moment.
 * 
 * Requirements: asciinema, ffmpeg
 *   npm install -g asciinema
 *   (ffmpeg: winget install ffmpeg / brew install ffmpeg / apt install ffmpeg)
 * 
 * Usage: node scripts/generate-demo.mjs
 * Output: docs/assets/demo.gif
 */

import { spawn } from "node:child_process"
import fs from "node:fs"
import path from "node:path"

const DURATION = 30 // seconds
const OUTPUT_GIF = "docs/assets/demo.gif"
const CAST_FILE = ".oficina-demo/demo.cast"
const DEMO_DIR = ".oficina-demo"

async function checkTools() {
  const tools = ["asciinema", "ffmpeg"]
  for (const tool of tools) {
    try {
      const res = await runCmd(tool, ["--version"])
      console.log(`✓ ${tool}: ${res.stdout.trim().split("\n")[0]}`)
    } catch {
      console.error(`✗ ${tool} not found`)
      return false
    }
  }
  return true
}

function runCmd(cmd, args) {
  return new Promise((resolve, reject) => {
    const proc = spawn(cmd, args, { stdio: "pipe" })
    let stdout = "", stderr = ""
    proc.stdout.on("data", d => stdout += d.toString())
    proc.stderr.on("data", d => stderr += d.toString())
    proc.on("close", code => code === 0 ? resolve({ stdout, stderr }) : reject(new Error(stderr)))
  })
}

async function recordDemo() {
  console.log("🎬 Recording demo with asciinema...")
  
  // Start asciinema recording
  const asciinema = spawn("asciinema", ["rec", CAST_FILE, "-c", "npx oficina demo"], {
    stdio: "inherit",
    cwd: process.cwd()
  })
  
  // Wait for recording duration + buffer
  await new Promise(resolve => setTimeout(resolve, 35000))
  
  // Stop recording
  asciinema.kill("SIGINT")
  await new Promise(resolve => setTimeout(resolve, 2000))
  
  console.log("✓ Recording saved to", CAST_FILE)
}

async function convertToGif() {
  console.log("🎞 Converting to GIF with ffmpeg...")
  
  // Convert asciicast to GIF
  await runCmd("ffmpeg", [
    "-y",
    "-i", CAST_FILE,
    "-vf", "fps=10,scale=1200:-1:flags=lanczos,palettegen",
    "palette.png"
  ])
  
  await runCmd("ffmpeg", [
    "-y",
    "-i", CAST_FILE,
    "-i", "palette.png",
    "-lavfi", "fps=10,scale=1200:-1:flags=lanczos [x]; [x][1:v] paletteuse",
    "-loop", "0",
    OUTPUT_GIF
  ])
  
  fs.unlinkSync("palette.png")
  console.log("✓ GIF saved to", OUTPUT_GIF)
}

async function main() {
  console.log("🚀 AI-OFFICE Demo GIF Generator")
  console.log("================================")
  
  if (!await checkTools()) {
    console.log("\n⚠️  Tools missing. Install:")
    console.log("  npm install -g asciinema")
    console.log("  winget install ffmpeg  (Windows)")
    console.log("  brew install ffmpeg    (macOS)")
    console.log("  apt install ffmpeg     (Linux)")
    process.exit(1)
  }
  
  try {
    // Step 1: Seed demo data
    console.log("\n📦 Seeding demo data...")
    await runCmd("npx", ["oficina", "demo"])
    await new Promise(r => setTimeout(r, 3000))
    
    // Step 2: Record
    await recordDemo()
    
    // Step 3: Convert
    await convertToGif()
    
    // Verify output
    const stats = fs.statSync(OUTPUT_GIF)
    const sizeKB = Math.round(stats.size / 1024)
    console.log(`\n✅ Demo GIF ready: ${OUTPUT_GIF} (${sizeKB} KB)`)
    
  } catch (err) {
    console.error("❌ Error:", err.message)
    process.exit(1)
  }
}

const OUTPUT_GIF = "docs/assets/demo.gif"

main()