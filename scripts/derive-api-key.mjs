/**
 * Polymarket CLOB API Key Derivation Script
 * =========================================
 * Run this ONCE to get your API key, secret, and passphrase.
 * Then paste the values into your .env.local file.
 *
 * Usage:
 *   PRIVATE_KEY=0xyour_private_key node scripts/derive-api-key.mjs
 *
 * Or: node scripts/derive-api-key.mjs
 * (It will prompt for the private key)
 *
 * Prerequisites:
 *   npm install ethers
 *
 * SECURITY: Never commit your private key. Only run this locally.
 *
 * How it works:
 * - The Polymarket CLOB uses EIP-712 signing (L1) to prove wallet ownership
 * - It calls POST /auth/derive-api-key with L1 headers
 * - That returns { apiKey, secret, passphrase } which you store in .env.local
 * - All subsequent CLOB requests use these with HMAC-SHA256 (L2 auth)
 */

import { createInterface } from 'readline'
import crypto from 'crypto'
import https from 'https'

const CLOB_API = 'https://clob.polymarket.com'

// EIP-712 domain and type for Polymarket auth
const CHAIN_ID = 137 // Polygon Mainnet

async function getPrivateKey() {
  if (process.env.PRIVATE_KEY) return process.env.PRIVATE_KEY.trim()
  
  const rl = createInterface({ input: process.stdin, output: process.stdout })
  return new Promise((resolve) => {
    rl.question('Enter your Polygon wallet private key (0x...): ', (answer) => {
      rl.close()
      resolve(answer.trim())
    })
  })
}

function httpsPost(url, body, headers) {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url)
    const data = JSON.stringify(body)
    const options = {
      hostname: parsed.hostname,
      path: parsed.pathname + parsed.search,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(data),
        ...headers,
      },
    }
    const req = https.request(options, (res) => {
      let responseData = ''
      res.on('data', (chunk) => (responseData += chunk))
      res.on('end', () => {
        if (res.statusCode >= 200 && res.statusCode < 300) {
          resolve(JSON.parse(responseData))
        } else {
          reject(new Error(`HTTP ${res.statusCode}: ${responseData}`))
        }
      })
    })
    req.on('error', reject)
    req.write(data)
    req.end()
  })
}

async function main() {
  let ethers
  try {
    ethers = await import('ethers')
  } catch {
    console.error('\n❌ Missing dependency. Run: npm install ethers\n')
    process.exit(1)
  }

  const privateKey = await getPrivateKey()
  if (!privateKey || !privateKey.startsWith('0x') || privateKey.length !== 66) {
    console.error('\n❌ Invalid private key format. Must be 0x followed by 64 hex chars.\n')
    process.exit(1)
  }

  const wallet = new ethers.Wallet(privateKey)
  const address = wallet.address
  console.log(`\n✅ Wallet address: ${address}`)

  const timestamp = Math.floor(Date.now() / 1000)
  const nonce = 0

  // EIP-712 message for Polymarket CLOB auth
  const domain = {
    name: 'ClobAuthDomain',
    version: '1',
    chainId: CHAIN_ID,
  }
  const types = {
    ClobAuth: [
      { name: 'address', type: 'address' },
      { name: 'timestamp', type: 'string' },
      { name: 'nonce', type: 'uint256' },
      { name: 'message', type: 'string' },
    ],
  }
  const message = {
    address: address,
    timestamp: timestamp.toString(),
    nonce: nonce,
    message: 'This message attests that I control the given wallet',
  }

  console.log('🔑 Signing EIP-712 message...')
  const signature = await wallet.signTypedData(domain, types, message)

  const l1Headers = {
    'POLY_ADDRESS': address,
    'POLY_SIGNATURE': signature,
    'POLY_TIMESTAMP': timestamp.toString(),
    'POLY_NONCE': nonce.toString(),
  }

  console.log('🌐 Calling Polymarket CLOB /auth/derive-api-key...')
  try {
    const result = await httpsPost(`${CLOB_API}/auth/derive-api-key`, {}, l1Headers)

    console.log('\n' + '='.repeat(60))
    console.log('✅ SUCCESS! Add these to your .env.local:')
    console.log('='.repeat(60))
    console.log(`POLY_ADDRESS=${address}`)
    console.log(`POLY_API_KEY=${result.apiKey}`)
    console.log(`POLY_API_SECRET=${result.secret}`)
    console.log(`POLY_API_PASSPHRASE=${result.passphrase}`)
    console.log('='.repeat(60))
    console.log('\n⚠️  NEVER commit .env.local to git!\n')
  } catch (err) {
    console.error('\n❌ API call failed:', err.message)
    console.error('\nTips:')
    console.error('  - Make sure you are using the Polygon wallet that is connected to Polymarket')
    console.error('  - For proxy wallets (email/Magic), use signature_type=1')
    console.error('  - Check docs: https://docs.polymarket.com/developers/clob-api/authentication')
    process.exit(1)
  }
}

main().catch(console.error)
