// frontend/script.js
// Firebase & UI Logic
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js";
import { getAuth, signInWithPopup, GoogleAuthProvider, signOut, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";

// ======================== CONFIGURATION =========================
// Backend API URL - change to your Render backend url when deployed
const BACKEND_API_URL = "https://instagram-reel-downloader-cc6q.onrender.com"; // replace or use env
// For local development: http://localhost:5000
// For production: set to actual render URL

// Initialize Firebase only if config exists
let auth = null;
let currentUser = null;
if (window.FIREBASE_CONFIG && window.FIREBASE_CONFIG.apiKey !== "YOUR_API_KEY") {
    const app = initializeApp(window.FIREBASE_CONFIG);
    auth = getAuth(app);
} else {
    console.warn("Firebase not configured properly. Auth disabled.");
}

// DOM Elements
const reelUrlInput = document.getElementById('reelUrl');
const downloadBtn = document.getElementById('downloadBtn');
const copyUrlBtn = document.getElementById('copyUrlBtn');
const loadingIndicator = document.getElementById('loadingIndicator');
const resultCard = document.getElementById('resultCard');
const thumbnailImg = document.getElementById('thumbnailImg');
const videoTitleSpan = document.getElementById('videoTitle');
const downloadLink = document.getElementById('downloadLink');
const copyDownloadLinkBtn = document.getElementById('copyDownloadLinkBtn');
const closeResult = document.getElementById('closeResult');
const historyListDiv = document.getElementById('historyList');
const clearHistoryBtn = document.getElementById('clearHistoryBtn');
const googleSignInBtn = document.getElementById('googleSignInBtn');
const userProfileDiv = document.getElementById('userProfile');
const signOutBtn = document.getElementById('signOutBtn');
const toastContainer = document.getElementById('toastContainer');

// History management (localStorage)
let downloadHistory = [];

function loadHistory() {
    const stored = localStorage.getItem('reel_download_history');
    if (stored) {
        downloadHistory = JSON.parse(stored);
    } else {
        downloadHistory = [];
    }
    renderHistory();
}

function saveHistory() {
    localStorage.setItem('reel_download_history', JSON.stringify(downloadHistory.slice(0, 15)));
    renderHistory();
}

function addToHistory(url, title, downloadId, thumbnailUrl) {
    const newEntry = {
        id: downloadId,
        url: url,
        title: title || 'Instagram Reel',
        thumbnail: thumbnailUrl,
        timestamp: Date.now()
    };
    downloadHistory = [newEntry, ...downloadHistory.filter(item => item.id !== downloadId)].slice(0, 20);
    saveHistory();
}

function renderHistory() {
    if (!historyListDiv) return;
    if (downloadHistory.length === 0) {
        historyListDiv.innerHTML = '<div class="empty-history">No downloads yet. Paste a reel URL above!</div>';
        return;
    }
    historyListDiv.innerHTML = downloadHistory.map(item => `
        <div class="history-item" data-id="${item.id}">
            <div style="display:flex; gap:12px; align-items:center;">
                <img src="${item.thumbnail}" style="width: 48px; height:48px; object-fit:cover; border-radius:8px;">
                <div><strong>${escapeHtml(item.title.substring(0, 30))}</strong><br><small>${new Date(item.timestamp).toLocaleString()}</small></div>
            </div>
            <button class="btn-small-outline re-download-btn" data-id="${item.id}" data-url="${item.url}">Download Again</button>
        </div>
    `).join('');
    // attach re-download event
    document.querySelectorAll('.re-download-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
            e.stopPropagation();
            const url = btn.getAttribute('data-url');
            if (url) {
                reelUrlInput.value = url;
                startDownload();
            }
        });
    });
}

clearHistoryBtn?.addEventListener('click', () => {
    downloadHistory = [];
    saveHistory();
    showToast("History cleared", "info");
});

// Helper
function showToast(message, type = "success") {
    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    toast.innerText = message;
    toastContainer.appendChild(toast);
    setTimeout(() => { toast.remove(); }, 3000);
}

function escapeHtml(str) { return str.replace(/[&<>]/g, function(m){if(m==='&') return '&amp;'; if(m==='<') return '&lt;'; if(m==='>') return '&gt;'; return m;}); }

// Copy URL button
copyUrlBtn?.addEventListener('click', () => {
    if (reelUrlInput.value) {
        navigator.clipboard.writeText(reelUrlInput.value);
        showToast("URL copied to clipboard", "success");
    } else { showToast("Nothing to copy", "error"); }
});

// Main download logic
async function startDownload() {
    const url = reelUrlInput.value.trim();
    if (!url) {
        showToast("Please paste an Instagram Reel URL", "error");
        return;
    }
    if (!url.includes('instagram.com/reel/') && !url.includes('instagram.com/p/')) {
        showToast("Invalid Instagram Reel URL", "error");
        return;
    }
    // show loading
    loadingIndicator.style.display = "block";
    resultCard.style.display = "none";
    downloadBtn.disabled = true;
    try {
        const response = await fetch(`${BACKEND_API_URL}/download`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ url: url })
        });
        const data = await response.json();
        if (!response.ok || !data.success) {
            throw new Error(data.error || "Download failed");
        }
        // Success response: { downloadId, title, thumbnailUrl }
        const { downloadId, title, thumbnailUrl } = data;
        if (thumbnailUrl) thumbnailImg.src = thumbnailUrl;
        else thumbnailImg.src = "https://placehold.co/400x400?text=Preview";
        videoTitleSpan.innerText = title || "Instagram Reel";
        const videoDownloadUrl = `${BACKEND_API_URL}/video/${downloadId}`;
        downloadLink.href = videoDownloadUrl;
        downloadLink.setAttribute('download', `${title || 'reel'}.mp4`);
        resultCard.style.display = "block";
        // add to history
        addToHistory(url, title, downloadId, thumbnailUrl);
        showToast("Video ready! Click download button.");
    } catch (err) {
        console.error(err);
        showToast(err.message || "Something went wrong. Check backend or URL.", "error");
    } finally {
        loadingIndicator.style.display = "none";
        downloadBtn.disabled = false;
    }
}
downloadBtn?.addEventListener('click', startDownload);
closeResult?.addEventListener('click', () => { resultCard.style.display = "none"; });
copyDownloadLinkBtn?.addEventListener('click', () => {
    if (downloadLink.href) {
        navigator.clipboard.writeText(downloadLink.href);
        showToast("Download link copied");
    } else { showToast("No video ready", "error"); }
});

// Firebase Auth Optional
if (auth && googleSignInBtn) {
    const provider = new GoogleAuthProvider();
    googleSignInBtn.addEventListener('click', async () => {
        try {
            const result = await signInWithPopup(auth, provider);
            currentUser = result.user;
            updateUIBasedOnAuth(currentUser);
            showToast(`Welcome ${currentUser.displayName}!`, "success");
        } catch (err) { console.error(err); showToast("Sign in failed", "error"); }
    });
    signOutBtn?.addEventListener('click', async () => {
        await signOut(auth);
        currentUser = null;
        updateUIBasedOnAuth(null);
        showToast("Signed out");
    });
    onAuthStateChanged(auth, (user) => {
        currentUser = user;
        updateUIBasedOnAuth(user);
    });
} else if (googleSignInBtn) {
    googleSignInBtn.style.display = "none";
}

function updateUIBasedOnAuth(user) {
    if (user && userProfileDiv) {
        googleSignInBtn.style.display = "none";
        userProfileDiv.style.display = "flex";
        document.getElementById('userAvatar').src = user.photoURL || "https://ui-avatars.com/api/?background=8b5cf6&color=fff&name="+user.displayName;
        document.getElementById('userName').innerText = user.displayName?.split(' ')[0] || "User";
    } else if (userProfileDiv) {
        googleSignInBtn.style.display = "flex";
        userProfileDiv.style.display = "none";
    }
}
// FAQ accordion
document.querySelectorAll('.faq-question').forEach(btn => {
    btn.addEventListener('click', () => {
        const ans = btn.nextElementSibling;
        ans.classList.toggle('active');
        ans.style.display = ans.classList.contains('active') ? "block" : "none";
    });
});
loadHistory();
// Mobile menu toggle (basic)
const mobileToggle = document.getElementById('mobileMenuToggle');
const navLinks = document.querySelector('.nav-links');
if (mobileToggle) {
    mobileToggle.addEventListener('click', () => {
        if (navLinks.style.display === 'flex') navLinks.style.display = 'none';
        else navLinks.style.display = 'flex';
    });
}
