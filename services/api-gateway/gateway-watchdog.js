/**
 * API Gateway Watchdog / Health Monitor
 * ──────────────────────────────────────
 * Monitors the primary API Gateway and provides:
 *   • Health polling with configurable interval
 *   • Auto-restart on crash detection
 *   • Secondary gateway failover (hot standby)
 *   • Circuit-breaker style failure tracking
 *
 * Addresses: API Gateway Single Point of Failure (SPOF)
 *
 * Usage:
 *   node gateway-watchdog.js
 *   or: SECONDARY_PORT=3010 node gateway-watchdog.js
 */

const { fork } = require('child_process');
const http = require('http');
const path = require('path');

// ─── Configuration ───────────────────────────────────────────────
const PRIMARY_PORT = parseInt(process.env.PORT) || 3000;
const SECONDARY_PORT = parseInt(process.env.SECONDARY_PORT) || 3010;
const HEALTH_CHECK_INTERVAL = parseInt(process.env.HEALTH_CHECK_INTERVAL) || 5000; // 5 seconds
const MAX_RESTART_ATTEMPTS = parseInt(process.env.MAX_RESTART_ATTEMPTS) || 10;
const RESTART_COOLDOWN = parseInt(process.env.RESTART_COOLDOWN) || 3000; // 3 seconds
const FAILURE_THRESHOLD = parseInt(process.env.FAILURE_THRESHOLD) || 3; // consecutive failures before restart

// ─── State ───────────────────────────────────────────────────────
let primaryProcess = null;
let secondaryProcess = null;
let restartCount = 0;
let consecutiveFailures = 0;
let isSecondaryActive = false;
let watchdogRunning = true;

// ─── Health Check ────────────────────────────────────────────────
function checkHealth(port) {
  return new Promise((resolve) => {
    const req = http.get(`http://localhost:${port}/health`, { timeout: 3000 }, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        try {
          const body = JSON.parse(data);
          resolve({ healthy: res.statusCode === 200 && body.status === 'OK', data: body });
        } catch {
          resolve({ healthy: false, data: null });
        }
      });
    });
    req.on('error', () => resolve({ healthy: false, data: null }));
    req.on('timeout', () => { req.destroy(); resolve({ healthy: false, data: null }); });
  });
}

// ─── Start Gateway Process ───────────────────────────────────────
function startGateway(port, label) {
  return new Promise((resolve) => {
    const env = { ...process.env, PORT: port.toString() };
    const child = fork(path.join(__dirname, 'server.js'), [], {
      env,
      stdio: ['pipe', 'pipe', 'pipe', 'ipc']
    });

    child.stdout.on('data', (data) => {
      process.stdout.write(`[${label}:${port}] ${data}`);
    });

    child.stderr.on('data', (data) => {
      process.stderr.write(`[${label}:${port}] ${data}`);
    });

    child.on('exit', (code, signal) => {
      console.log(`\n⚠️  [${label}:${port}] Process exited (code: ${code}, signal: ${signal})`);
      if (label === 'PRIMARY' && watchdogRunning) {
        console.log('🔄 Primary gateway crashed! Activating secondary...');
        activateSecondary();
      }
    });

    // Give the server time to boot
    setTimeout(() => {
      console.log(`✅ [${label}:${port}] Gateway process started (PID: ${child.pid})`);
      resolve(child);
    }, 2000);
  });
}

// ─── Activate Secondary Gateway ──────────────────────────────────
async function activateSecondary() {
  if (isSecondaryActive) {
    console.log('ℹ️  Secondary gateway already active');
    return;
  }

  try {
    console.log(`🚀 Starting secondary gateway on port ${SECONDARY_PORT}...`);
    secondaryProcess = await startGateway(SECONDARY_PORT, 'SECONDARY');
    isSecondaryActive = true;
    console.log(`✅ Secondary gateway active on port ${SECONDARY_PORT}`);

    // Attempt to restart primary
    setTimeout(() => restartPrimary(), RESTART_COOLDOWN);
  } catch (err) {
    console.error('❌ Failed to start secondary gateway:', err.message);
  }
}

// ─── Restart Primary Gateway ─────────────────────────────────────
async function restartPrimary() {
  if (restartCount >= MAX_RESTART_ATTEMPTS) {
    console.error(`❌ Max restart attempts (${MAX_RESTART_ATTEMPTS}) reached. Manual intervention required.`);
    return;
  }

  restartCount++;
  console.log(`\n🔄 Restarting primary gateway (attempt ${restartCount}/${MAX_RESTART_ATTEMPTS})...`);

  try {
    // Kill old process if still hanging
    if (primaryProcess && !primaryProcess.killed) {
      primaryProcess.kill('SIGTERM');
      await new Promise(r => setTimeout(r, 1000));
    }

    primaryProcess = await startGateway(PRIMARY_PORT, 'PRIMARY');

    // Verify it started successfully
    await new Promise(r => setTimeout(r, 3000));
    const health = await checkHealth(PRIMARY_PORT);

    if (health.healthy) {
      console.log('✅ Primary gateway restored successfully!');
      consecutiveFailures = 0;

      // Shut down secondary
      if (isSecondaryActive && secondaryProcess) {
        console.log('🔄 Shutting down secondary gateway...');
        secondaryProcess.kill('SIGTERM');
        isSecondaryActive = false;
        secondaryProcess = null;
      }
    } else {
      console.warn('⚠️ Primary restarted but health check failed, retrying...');
      setTimeout(() => restartPrimary(), RESTART_COOLDOWN * 2);
    }
  } catch (err) {
    console.error('❌ Restart failed:', err.message);
    setTimeout(() => restartPrimary(), RESTART_COOLDOWN * 2);
  }
}

// ─── Health Monitor Loop ─────────────────────────────────────────
async function monitorHealth() {
  while (watchdogRunning) {
    await new Promise(r => setTimeout(r, HEALTH_CHECK_INTERVAL));

    const primaryHealth = await checkHealth(PRIMARY_PORT);

    if (primaryHealth.healthy) {
      if (consecutiveFailures > 0) {
        console.log(`✅ Primary gateway recovered after ${consecutiveFailures} failures`);
      }
      consecutiveFailures = 0;
    } else {
      consecutiveFailures++;
      console.warn(`⚠️ Primary health check failed (${consecutiveFailures}/${FAILURE_THRESHOLD})`);

      if (consecutiveFailures >= FAILURE_THRESHOLD) {
        console.error(`❌ Primary gateway unresponsive after ${FAILURE_THRESHOLD} checks!`);
        activateSecondary();
        await restartPrimary();
        consecutiveFailures = 0;
      }
    }

    // Also monitor secondary if active
    if (isSecondaryActive) {
      const secondaryHealth = await checkHealth(SECONDARY_PORT);
      if (!secondaryHealth.healthy) {
        console.warn('⚠️ Secondary gateway health check failed');
      }
    }
  }
}

// ─── Watchdog Status Endpoint ────────────────────────────────────
const watchdogApp = http.createServer((req, res) => {
  if (req.url === '/watchdog/status') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      watchdog: 'running',
      primary: { port: PRIMARY_PORT, pid: primaryProcess?.pid, restartCount },
      secondary: { port: SECONDARY_PORT, active: isSecondaryActive, pid: secondaryProcess?.pid },
      consecutiveFailures,
      timestamp: new Date().toISOString()
    }));
  } else {
    res.writeHead(404);
    res.end('Not found');
  }
});

// ─── Main Entry ──────────────────────────────────────────────────
async function main() {
  console.log('═══════════════════════════════════════════════════');
  console.log('   SwiftLogistics API Gateway Watchdog');
  console.log('   SPOF Protection: Auto-restart + Hot Standby');
  console.log('═══════════════════════════════════════════════════');
  console.log(`   Primary port:     ${PRIMARY_PORT}`);
  console.log(`   Secondary port:   ${SECONDARY_PORT}`);
  console.log(`   Health interval:  ${HEALTH_CHECK_INTERVAL}ms`);
  console.log(`   Failure threshold: ${FAILURE_THRESHOLD}`);
  console.log(`   Max restarts:     ${MAX_RESTART_ATTEMPTS}`);
  console.log('═══════════════════════════════════════════════════\n');

  // Start primary gateway
  primaryProcess = await startGateway(PRIMARY_PORT, 'PRIMARY');

  // Start watchdog status server on a separate port
  const WATCHDOG_PORT = parseInt(process.env.WATCHDOG_PORT) || 3099;
  watchdogApp.listen(WATCHDOG_PORT, () => {
    console.log(`🐕 Watchdog status: http://localhost:${WATCHDOG_PORT}/watchdog/status`);
  });

  // Begin health monitoring
  monitorHealth();
}

// Graceful shutdown
process.on('SIGTERM', () => {
  console.log('\n🛑 Watchdog shutting down...');
  watchdogRunning = false;
  if (primaryProcess) primaryProcess.kill('SIGTERM');
  if (secondaryProcess) secondaryProcess.kill('SIGTERM');
  process.exit(0);
});

process.on('SIGINT', () => {
  console.log('\n🛑 Watchdog shutting down...');
  watchdogRunning = false;
  if (primaryProcess) primaryProcess.kill('SIGTERM');
  if (secondaryProcess) secondaryProcess.kill('SIGTERM');
  process.exit(0);
});

main().catch(err => {
  console.error('❌ Watchdog fatal error:', err);
  process.exit(1);
});
