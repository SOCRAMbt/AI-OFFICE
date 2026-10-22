import { analyzeShellCommand } from "../src/core/sandbox.ts"

const comandos = [
  "echo hola > salida.txt",
  "cat a.txt | tee b.txt",
  "cp -r src dist",
  "mv a.txt b.txt",
  "rm -rf build",
  "sed -i 's/a/b/' archivo.txt",
  "dd if=/dev/zero of=dump.img bs=1M",
  "curl https://x.com/f -o descargado.bin",
  `python -c "open('/etc/passwd','w').write('x')"`,
  `node -e "require('fs').writeFileSync('/tmp/x','y')"`,
  `python -c "import os; os.remove('secreto')"`,
  "cat package.json && npm test",
]

for (const cmd of comandos) {
  const c = analyzeShellCommand(cmd)
  console.log(cmd)
  console.log(
    "   ->",
    c.length === 0
      ? "(nada)"
      : c.map((x) => `${x.op}:${x.target || "?"}${x.uncertain ? "?" : ""}`).join(", "),
  )
}
