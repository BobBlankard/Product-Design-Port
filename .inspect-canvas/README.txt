The CLI cannot be copied here alone — it needs node_modules (express, open, @babel/*).

Always start from the project root:
  ./start-inspect-canvas.sh

That runs: cd ~/Downloads/inspect-canvas-main && node dist/cli.js "/path/to/Product Design Port" -p 3102
  (Override port: IC_PORT=3100 ./start-inspect-canvas.sh)

You can delete cli.js if it was copied here earlier; it will not work by itself.
