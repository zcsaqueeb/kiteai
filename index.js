// Import dependencies
import chalk from 'chalk';
import { createRequire } from 'module';
import { fileURLToPath } from 'url';
import { dirname } from 'path';
import { createInterface } from 'readline';
import { SocksProxyAgent } from 'socks-proxy-agent';
import { HttpsProxyAgent } from 'https-proxy-agent';
import { HttpProxyAgent } from 'http-proxy-agent';
import axios from 'axios';
import axiosRetry from 'axios-retry';
import fs from 'fs';
import { banner } from './banner.js';

const require = createRequire(import.meta.url);
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const readline = createInterface({
  input: process.stdin,
  output: process.stdout
});

// Rate Limiting Configuration
const rateLimitConfig = {
  maxRetries: 5,
  requestsPerMinute: 15,
  intervalBetweenCycles: 15000
};

let requestTimestamps = [];
let isRunning = true;

// Handle CTRL+C
process.on('SIGINT', () => {
  console.log(chalk.yellow('\n\n🛑 Stopping the script gracefully...'));
  isRunning = false;
  setTimeout(() => {
    console.log(chalk.green('👋 Thank you for using Kite AI!'));
    process.exit(0);
  }, 1000);
});

// Agents
const agents = {
  "deployment_p5J9lz1Zxe7CYEoo0TZpRVay": "Professor 🧠",
  "deployment_7sZJSiCqCNDy9bBHTEh7dwd9": "Crypto Buddy 💰",
  "deployment_SoFftlsf9z4fyA3QCHYkaANq": "Sherlock 🔎"
};

// Proxy Management
const proxyConfig = {
  enabled: false,
  proxies: []
};
const failedProxies = new Set();

function loadProxiesFromFile() {
  try {
    const proxyList = fs.readFileSync('proxies.txt', 'utf-8')
      .split('\n')
      .filter(line => line.trim());
    proxyConfig.proxies = proxyList;
    console.log(chalk.green(`✅ Loaded ${proxyList.length} proxies`));
  } catch {
    console.log(chalk.yellow('⚠️ No proxies found. Using direct connection.'));
  }
}

function getNextProxy() {
  if (!proxyConfig.enabled || proxyConfig.proxies.length === 0) {
    return null;
  }
  const availableProxies = proxyConfig.proxies.filter(proxy => !failedProxies.has(proxy));
  if (availableProxies.length === 0) {
    console.log(chalk.red("❌ All proxies failed. Retrying in 30s..."));
    sleep(30000);
    failedProxies.clear();
    return getNextProxy();
  }
  return availableProxies[Math.floor(Math.random() * availableProxies.length)];
}

function markProxyAsFailed(proxy) {
  if (proxy) {
    failedProxies.add(proxy);
    console.log(chalk.yellow(`⚠️ Proxy failed: ${proxy}`));
  }
}

function createProxyAgent(proxyUrl) {
  try {
    if (!proxyUrl) return null;
    if (proxyUrl.startsWith('socks')) {
      return new SocksProxyAgent(proxyUrl);
    } else if (proxyUrl.startsWith('http')) {
      return {
        https: new HttpsProxyAgent(proxyUrl),
        http: new HttpProxyAgent(proxyUrl)
      };
    }
    return null;
  } catch {
    return null;
  }
}

function createAxiosInstance(proxyUrl = null) {
  const config = { headers: { 'Content-Type': 'application/json' } };
  if (proxyUrl) {
    const proxyAgent = createProxyAgent(proxyUrl);
    if (proxyAgent) {
      config.httpsAgent = proxyAgent.https || proxyAgent;
      config.httpAgent = proxyAgent.http || proxyAgent;
    }
  }

  const axiosInstance = axios.create(config);
  axiosRetry(axiosInstance, {
    retries: 3,
    retryDelay: (retryCount) => 1000 * Math.pow(2, retryCount),
    retryCondition: (error) => error.response?.status >= 500 || error.code === 'ECONNABORTED'
  });

  return axiosInstance;
}

// Rate Limiting
const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

const checkRateLimit = async () => {
  const now = Date.now();
  requestTimestamps = requestTimestamps.filter(ts => now - ts < 60000);
  if (requestTimestamps.length >= rateLimitConfig.requestsPerMinute) {
    const waitTime = requestTimestamps[0] + 60000 - now;
    console.log(chalk.yellow(`⏳ Rate limit reached. Waiting ${Math.ceil(waitTime / 1000)}s...`));
    await sleep(waitTime);
  }
  requestTimestamps.push(Date.now());
};

// Core Functions
async function sendRandomQuestion(agent, axiosInstance) {
  try {
    await checkRateLimit();
    const questions = JSON.parse(fs.readFileSync('questions.json', 'utf-8'));
    const question = questions[Math.floor(Math.random() * questions.length)];

    const startTime = Date.now();
    const response = await axiosInstance.post(
      `https://${agent.toLowerCase().replace('_', '-')}.stag-vxzy.zettablock.com/main`,
      { message: question, stream: false }
    );
    console.log(chalk.green(`✅ Response in ${Date.now() - startTime}ms`));

    return { question, response: response.data.choices[0].message };
  } catch (error) {
    console.error(chalk.red('⚠️ Error:'), error.message);
    return null;
  }
}

async function reportUsage(wallet, options) {
  try {
    await checkRateLimit();
    await axios.post(`https://quests-usage-dev.prod.zettablock.com/api/report_usage`, {
      wallet_address: wallet,
      agent_id: options.agent_id,
      request_text: options.question,
      response_text: options.response,
      request_metadata: {}
    });
    console.log(chalk.green('✅ Usage reported\n'));
  } catch (error) {
    console.log(chalk.yellow('⚠️ Could not report usage.'));
  }
}

async function processAgentCycle(wallet, agentId, agentName, useProxy) {
  try {
    const proxy = useProxy ? getNextProxy() : null;
    const axiosInstance = createAxiosInstance(proxy);
    if (proxy) console.log(chalk.blue(`🌐 Proxy: ${proxy}`));

    const response = await sendRandomQuestion(agentId, axiosInstance);
    if (response) {
      console.log(chalk.cyan('❓ Question:'), chalk.bold(response.question));
      console.log(chalk.green('💡 Answer:'), chalk.italic(response?.response?.content || 'No response'));

      await reportUsage(wallet, {
        agent_id: agentId,
        question: response.question,
        response: response?.response?.content || 'No response'
      });
    }
  } catch (error) {
    console.error(chalk.red('⚠️ Error in agent cycle:'), error.message);
  }
}

// Run Agents in Parallel
async function startContinuousProcess(wallet, useProxy) {
  console.log(chalk.blue(`\n📌 Processing wallet: ${wallet}`));
  while (isRunning) {
    await Promise.all(Object.entries(agents).map(([agentId, agentName]) =>
      processAgentCycle(wallet, agentId, agentName, useProxy)
    ));
    await sleep(rateLimitConfig.intervalBetweenCycles);
  }
}

// Main Function
async function main() {
  console.log(banner);
  
  const mode = await new Promise(resolve => readline.question('🔄 Connection mode (1: Direct, 2: Proxy): ', resolve));
  proxyConfig.enabled = mode === '2';
  if (proxyConfig.enabled) loadProxiesFromFile();
  
  const walletMode = await new Promise(resolve => readline.question('📋 Wallet mode (1: Manual, 2: File): ', resolve));
  const wallets = walletMode === '2' ? fs.readFileSync('wallets.txt', 'utf-8').split('\n').filter(w => w.trim()) : [await new Promise(resolve => readline.question('🔑 Enter wallet: ', resolve))];

  for (const wallet of wallets) await startContinuousProcess(wallet.toLowerCase(), proxyConfig.enabled);
}

main();
