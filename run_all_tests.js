const { spawn } = require('child_process');
const path = require('path');
const { runTests } = require('./test_routes');

async function main() {
  console.log('Starting Express server for test execution...');
  const serverProcess = spawn('node', ['index.js'], {
    cwd: __dirname,
    stdio: ['inherit', 'pipe', 'pipe'],
  });

  serverProcess.stdout.on('data', (data) => {
    process.stdout.write(`[Server stdout] ${data}`);
  });

  serverProcess.stderr.on('data', (data) => {
    process.stderr.write(`[Server stderr] ${data}`);
  });

  // Wait 1.5 seconds for server and DB initialization
  await new Promise((resolve) => setTimeout(resolve, 1500));

  try {
    await runTests();
    console.log('\nTests completed with exit code 0.');
  } catch (error) {
    console.error('Tests failed:', error);
    process.exitCode = 1;
  } finally {
    serverProcess.kill('SIGINT');
    process.exit(process.exitCode || 0);
  }
}

main();

