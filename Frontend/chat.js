const CHAT_API_BASE = 'http://127.0.0.1:3000'; // backend

const $c = (sel) => document.querySelector(sel);

const chatToggle   = $c('#chatToggle');
const chatPanel    = $c('#chatPanel');
const chatClose    = $c('#chatClose');
const chatMessages = $c('#chatMessages');
const chatInput    = $c('#chatInput');
const chatSendBtn  = $c('#chatSend');

function appendChat(content, mine = false) {
  const item = document.createElement('div');
  item.className = 'chat-msg ' + (mine ? 'chat-me' : 'chat-bot');
  item.textContent = content;
  chatMessages.appendChild(item);
  chatMessages.scrollTop = chatMessages.scrollHeight;
}

function openChat() {
  chatPanel.classList.add('show');
  chatInput.focus();
}

function closeChat() {
  chatPanel.classList.remove('show');
}

async function sendChat() {
  const text = chatInput.value.trim();
  if (!text) return;

  appendChat(text, true);
  chatInput.value = '';

  try {
    const res = await fetch(`${CHAT_API_BASE}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text }),       // <-- backend đọc req.body.text
    });

    const data = await res.json().catch(() => ({}));

    if (!res.ok) {
      appendChat('⚠️ Lỗi server: ' + (data.message || res.status));
      return;
    }
    appendChat(data.reply || '(bot không trả lời)');
  } catch (err) {
    console.error(err);
    appendChat('⚠️ Không kết nối được server.');
  }
}

// Gắn event
if (chatToggle) chatToggle.addEventListener('click', openChat);
if (chatClose)  chatClose.addEventListener('click', closeChat);
if (chatSendBtn) chatSendBtn.addEventListener('click', sendChat);
if (chatInput) {
  chatInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      sendChat();
    }
  });
}

// Tin nhắn chào
appendChat('🤖 Xin chào, mình là trợ lý đặt vé. Bạn có thể hỏi: "Giá vé Lagi đi Nha Trang ngày mai?"');