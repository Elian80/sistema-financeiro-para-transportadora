// =========================================================
// main.js — Processo principal do Electron
//
// Este arquivo sobe a janela desktop que carrega o frontend
// (renderer/login.html) e mantém o ciclo de vida básico do app.
// =========================================================

const { app, BrowserWindow } = require('electron');
const path = require('path');

// Reduz problemas gráficos em algumas GPUs/drivers no ambiente cliente.
app.disableHardwareAcceleration();

function createWindow() {
  // Janela principal do sistema financeiro desktop.
  const win = new BrowserWindow({
    width: 1400,
    height: 900,
    backgroundColor: '#0b1020'
  });

  win.loadFile(path.join(__dirname, 'renderer', 'login.html'));
}

app.whenReady().then(createWindow);

app.on('window-all-closed', () => {
  // Neste projeto, ao fechar a última janela o aplicativo é encerrado.
  app.quit();
});
