const { ethers } = require("ethers");
const fs = require("fs");
const readlineSync = require("readline-sync");
const chalk = require("chalk");

// Menampilkan jaringan Ethereum yang tersedia
console.log("Jaringan yang Tersedia:");

// Menentukan jumlah kolom untuk menampilkan pilihan jaringan
const columns = 5;

// Menampilkan pilihan jaringan dengan tata letak yang lebih rapi
const showNetworks = (networks) => {
  networks.forEach((network, index) => {
    const columnNumber = (index % columns) + 1;
    const padding = 18;

    const networkNumber = index + 1 < 10 ? `0${index + 1}` : index + 1;

    process.stdout.write(`${networkNumber}. ${network.name}`);

    // Menambahkan spasi untuk menyusun ke samping
    for (let i = 0; i < padding - network.name.length; i++) {
      process.stdout.write(" ");
    }

    // Pindah baris setelah mencapai batas kolom
    if (columnNumber === columns) {
      console.log();
    }
  });

  // Menambahkan baris baru setelah menampilkan pilihan jaringan
  console.log();
};

// Pilihan jaringan yang tersedia
const chainConfig = require("./chain.json");
showNetworks(chainConfig.networks);

// Mendapatkan input pengguna untuk pemilihan jaringan
const selectedNetworkIndex = readlineSync.questionInt("Pilih jaringan (masukkan nomor yang sesuai): ");
const selectedNetwork = chainConfig.networks[selectedNetworkIndex - 1];

if (!selectedNetwork) {
  console.error("Pemilihan jaringan tidak valid atau jaringan tidak ditemukan.");
  process.exit(1);
}

// Menghubungkan ke node Ethereum yang dipilih
const provider = new ethers.providers.JsonRpcProvider(selectedNetwork.rpc);

if (!provider) {
  console.error("Gagal menginisialisasi penyedia Ethereum.");
  process.exit(1);
}

// Membaca data dompet dari wallet.json
let walletData;
try {
  walletData = JSON.parse(fs.readFileSync("wallet.json", "utf-8"));
} catch (error) {
  console.error("Error membaca atau mengurai wallet.json:", error.message);
  process.exit(1);
}

// Memastikan walletData dan wallets terdefinisi
if (!walletData || !walletData.wallets) {
  console.error("Format wallet.json tidak valid. Pastikan berisi sebuah array dari dompet.");
  process.exit(1);
}

// Mengambil semua kunci privat dari wallet.json
const privateKeys = walletData.wallets.map(wallet => wallet.privateKey.trim());

// Menetapkan nilai kenaikan harga gas
const increaseGas = 1;

// Fungsi untuk mengonversi string ke heksadesimal
const convertToHex = (str = '') => {
  const res = [];
  for (let n = 0; n < str.length; n++) {
    const hex = Number(str.charCodeAt(n)).toString(16);
    res.push(hex);
  }
  return `0x${res.join('')}`;
};

// Menambahkan warna dan format ke output konsol
function logWithColor(message, color = "white") {
  console.log(chalk[color](message));
}

// Mendapatkan nonce saat ini dari dompet
async function getCurrentNonce(wallet) {
  try {
    const nonce = await wallet.getTransactionCount("pending");
    logWithColor(`Nonce: ${nonce}`, "green");
    return nonce;
  } catch (error) {
    logWithColor(`Error saat mengambil nonce: ${error.message}`, "red");
    throw error;
  }
}

// Fungsi untuk memeriksa harga gas
async function checkGasPrice() {
  try {
    const gasPrice = await provider.getGasPrice();
    return gasPrice;
  } catch (error) {
    console.error('Kesalahan saat mengambil harga gas:', error);
    throw error;
  }
}

// Mendapatkan harga gas saat ini dari jaringan
async function getCurrentGasPrice() {
  // Gunakan harga gas terendah secara otomatis
  const lowestGasPrice = await checkGasPrice();
  return lowestGasPrice;
}

// Estimasi gasLimit real-time di blockchain
async function getGasLimit(hexData, address) {
  const gasLimit = await provider.estimateGas({
    to: address,
    value: ethers.utils.parseEther("0"),
    data: hexData,
  });

  return gasLimit.toNumber();
}

// Kirim transaksi
async function sendTransaction(nonce, tokenJson, wallet, transactionIndex) {
  const hexData = convertToHex(tokenJson.trim());

  // Dapatkan harga gas real-time
  const currentGasPrice = await getCurrentGasPrice();

  // Tingkatkan harga gas dengan faktor tertentu
  const gasMultiplier = parseInt(String(increaseGas * 100));
  const increasedGasPrice = currentGasPrice.mul(gasMultiplier).div(100);

  // Dapatkan alamat dompet
  const address = await wallet.getAddress();

  // Hitung biaya total transaksi
  const totalCost = increasedGasPrice.mul(await getGasLimit(hexData, address));

  // Dapatkan saldo akun
  const accountBalance = await provider.getBalance(address);

  // Periksa apakah saldo mencukupi
  if (totalCost.gt(accountBalance)) {
    logWithColor(`Saldo tidak mencukupi untuk biaya transaksi. Saldo akun: ${ethers.utils.formatUnits(accountBalance, 'ether')} ${selectedNetwork.token || 'ETH'}`, "red");
    return;
  }

  // Tampilkan detail saldo awal sebelum transaksi
  if (transactionIndex === 1) {
    logWithColor(`\nSaldo Awal Akun (${chalk.cyan(address)}): ${chalk.green(ethers.utils.formatUnits(accountBalance, 'ether'))} ${selectedNetwork.token || 'ETH'}`, "yellow");
  }

  // Tampilkan detail transaksi
  logWithColor(`\n-----------------------------------------------------------------------------------------------------\n`);
  logWithColor(`Transaksi ke-${transactionIndex}`);
  logWithColor(`Nonce    : ${nonce}`);
  logWithColor(`Harga Gas: ${ethers.utils.formatUnits(increasedGasPrice, 'gwei')} gwei`);
  logWithColor(`Hex Data : ${chalk.hex('#FF00FF')(hexData)}`);

  const transaction = {
    to: address,
    value: ethers.utils.parseEther("0"),
    data: hexData,
    nonce: nonce,
    gasPrice: increasedGasPrice,
    gasLimit: await getGasLimit(hexData, address),
  };

  try {
    const tx = await wallet.sendTransaction(transaction);

    // Tampilkan link explorer
    const explorerLink = selectedNetwork.scan;
    logWithColor(`Explorer Link: ${explorerLink}/${tx.hash}`, "green");
  } catch (error) {
    if (error.code === "NONCE_EXPIRED") {
      logWithColor(`Kesalahan dalam transaksi dengan nonce ${nonce}: nonce has already been used [ See: https://links.ethers.org/v5-errors-NONCE_EXPIRED ]`, "green");
    } else {
      logWithColor(`Kesalahan dalam transaksi dengan nonce ${nonce}: ${error.message}`, "red");
    }
  }
}

// Dapatkan input pengguna untuk tokenJson
const tokenJson = readlineSync.question("Masukkan tokenJson: ") || 'data:,{"a":"NextInscription","p":"nirc-20","op":"mint","tick":"niux","amt":"100000000"}';

// Dapatkan input pengguna untuk repeatCount
const repeatCount = readlineSync.questionInt("Masukkan Jumlah Trx: ");

// ASCII art untuk roket
const rocketAscii = `
  _   _   _   _   _   _   _  
 / \\ / \\ / \\ / \\ / \\ / \\ / \\ 
( W | I | N | N | O | D | E )
 \\_/ \\_/ \\_/ \\_/ \\_/ \\_/ \\_/ 
`;

console.log(chalk.yellow(rocketAscii));

// Kirim transaksi untuk semua wallet dengan output konsol berwarna
async function sendRepeatedTransactionsAllWallets() {
  try {
    for (const privateKey of privateKeys) {
      // Buat dompet baru untuk setiap kunci privat
      const wallet = new ethers.Wallet(privateKey, provider);

      const currentNonce = await getCurrentNonce(wallet);

      // Periksa harga gas sebelum mengirim transaksi
      await checkGasPrice();

      for (let i = 0; i < repeatCount; i++) {
        const currentTransactionNonce = currentNonce + i;
        await sendTransaction(currentTransactionNonce, tokenJson, wallet, i + 1);

        // Tambahkan jeda antara transaksi (misalnya, 5 detik)
        const delayTime = 5000; // 5000 milidetik = 5 detik
        await new Promise((resolve) => setTimeout(resolve, delayTime));
      }
    }
  } catch (error) {
    console.error(`Kesalahan dalam mengambil nonce atau mengirim transaksi: Error`);
  }
}

// Jalankan transaksi untuk semua wallet dengan output konsol berwarna
sendRepeatedTransactionsAllWallets();
