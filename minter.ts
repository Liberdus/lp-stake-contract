import { ethers } from 'ethers';
import * as dotenv from 'dotenv';

dotenv.config();

async function mintTokens(destAddress: string, amount: string) {
  // Get private key from env
  const privateKey = process.env.PRIVATE_KEY;
  if (!privateKey) {
    throw new Error('Private key not found in environment variables');
  }

  // Connect to Amoy testnet
  const provider = new ethers.JsonRpcProvider('https://rpc-amoy.polygon.technology');
  const wallet = new ethers.Wallet(privateKey, provider);

  // Token contract address (LIB token on Amoy)
  const tokenAddress = '0xB52ac6A3bB8DADDb8B952cD19Df7Fffe814a0C31';

  // Contract ABI - we only need the mint function
  const abi = [
    'function mint(address to, uint256 amount) public'
  ];

  const contract = new ethers.Contract(tokenAddress, abi, wallet);

  try {
    const tx = await contract.mint(destAddress, amount);
    await tx.wait();
    console.log(`Successfully minted ${amount} tokens to ${destAddress}`);
    console.log(`Transaction hash: ${tx.hash}`);
  } catch (error) {
    console.error('Error minting tokens:', error);
  }
}

// Example usage:
// mintTokens("0x123...", "1000000000000000000"); // For 1 token (assuming 18 decimals)

mintTokens("0xeC122D3edADd8e5AA5cD97Dc2a541329D027d66A", "1000000000000000000000"); // For 1000 token (assuming 18 decimals)
