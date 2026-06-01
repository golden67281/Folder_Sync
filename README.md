# 📂 FolderSync

> **Bidirectional real-time file & folder synchronization** between your laptop and mobile phone over local Wi-Fi. No cloud, no accounts, zero-setup, and fully private.

---

## 🚀 How It Works (System Flow)

```mermaid
graph TD
    subgraph Laptop [🖥️ Laptop (Windows)]
        Dir[sync-folder/] <--> Watcher[Chokidar Watcher]
        Watcher <--> Server[Express + Socket.io Server]
    end
    
    subgraph Network [📡 Local Wi-Fi]
        Server <-->|WebSocket + REST API| WebUI[Mobile Web Interface]
    end

    subgraph Phone [📱 Phone (Android / iOS)]
        WebUI <--> Browser[Mobile Browser]
    end
```

1. **Laptop** runs a Node.js server that watches `sync-folder/` (or any custom folder you choose) using **Chokidar**.
2. **Phone** connects to the server by scanning the terminal-generated **QR Code** on the same Wi-Fi network.
3. **Laptop &rarr; Phone**: Any file changes on the laptop are instantly pushed to the phone via **WebSockets**.
4. **Phone &rarr; Laptop**: Upload files or entire folder trees from your phone's browser, which are recreated instantly on your laptop.

---

## ✨ Features

- **⚡ Instant Sync**: Files appear/disappear on the phone UI in real time as you edit them on your laptop.
- **📁 Folder uploads**: Upload entire nested folder structures directly from your phone.
- **🛡️ Custom "Save As" Prompts**: Rename files before downloading them on your phone.
- **💡 Built-in Mobile Path Guides**: Step-by-step instructions inside the mobile UI to configure Android Chrome or iOS Safari to prompt for specific saving folders.
- **🖥️ Desktop Panel**: Choose which root folder on your laptop to sync via a native Windows Folder Picker or direct path entry.
- **🎨 Glassmorphic UI**: High-end responsive dark-mode styling built on custom CSS variables.
- **⚙️ Auto-Port Freeing**: Automatically finds and terminates orphaned processes blocking the port to guarantee smooth runs.

---

## ⚡ Quick Start

### 1. Run the Server
Double-click `start-sync.bat` on your Windows laptop. 
*This will automatically:*
- Check for Node.js
- Install all npm dependencies (first time only)
- Configure Windows Firewall rules (for port `3000`)
- Free up port `3000` if it's in use
- Print a **QR Code** in your terminal

### 2. Connect Your Phone
- Make sure your phone is connected to the **same Wi-Fi network** as your laptop.
- Open your phone's camera and scan the **QR Code** printed in the terminal.
- Tap the link, and you're ready to sync!

---

## 📁 Repository Structure

```
FolderSync/
├── sync-folder/             # Default synchronized folder (drop files here)
├── sync-server/             # Node.js Express server backend
│   ├── public/
│   │   └── index.html       # The glassmorphic mobile web app
│   ├── kill-port.js         # Port conflict resolution utility
│   ├── server.js            # Express server & socket.io logic
│   └── package.json         # Dependency configuration
├── .gitignore               # Keeps your synced files & configurations private
├── start-sync.bat           # Automated start script for Windows
└── README.md                # This guide
```

---

## ⚙️ Prerequisites

- **Node.js** (v16.0.0 or higher) &mdash; Download it from [nodejs.org](https://nodejs.org).
- Both your laptop and phone must be on the **same Wi-Fi network**.

---

## 💡 How to Customize Phone Download Paths

By default, phone browsers save downloads directly to the system `Downloads` folder. If you want to choose the exact path on your phone:

- **Android (Chrome)**: Tap the 3-dots menu &rarr; **Settings** &rarr; **Downloads** &rarr; Toggle on **"Ask where to save files"**.
- **iOS iPhone (Safari)**: Open your phone's native **Settings App** &rarr; **Safari** &rarr; **Downloads** &rarr; Select **"Other..."** to pick any custom folder in your Files app.

---

## 🔧 Troubleshooting

| Issue | Cause / Fix |
|---|---|
| **Phone cannot connect** | Verify both devices are on the **same Wi-Fi**. Double check that your Wi-Fi network profile on Windows is set to **Private** so that local devices can discover your laptop. |
| **QR code is not scanning** | Manually enter the URL listed under `Phone URLs` in the laptop terminal (e.g. `http://192.168.x.x:3000`) into your phone's browser. |
| **Port 3000 error** | The batch file automatically kills any process on port `3000`. If you still get a port collision, you can change the `PORT` constant in `sync-server/server.js`. |

---

## 🔒 Privacy & Security

- **100% Local**: No internet is required. Your data is sent directly over your local Wi-Fi router.
- **No Third-Party Tracker**: No analytics, telemetry, or account logins.
