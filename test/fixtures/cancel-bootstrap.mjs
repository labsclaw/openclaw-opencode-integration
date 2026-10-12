// Test-only JS signal delivery for Windows (process.kill on Windows is forceful).
process.on("message", (message) => {
  if (message === "cancel") { process.emit("SIGTERM"); process.disconnect(); }
  if (message?.kind === "breakCleanup") {
    // Change only the running wrapper environment, after Node crypto initialized
    // and its fixture child started; corrupt SystemRoot at startup crashes Node.
    process.env.SystemRoot = message.root;
    process.emit("SIGTERM"); process.disconnect();
  }
});
