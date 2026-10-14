
const $ = id => document.getElementById(id);

const form = $("chatForm");
const promptBox = $("prompt");
const sendBtn = $("sendBtn");
const micBtn = $("micBtn");
const messagesBox = $("messages");
const welcome = $("welcome");
const chatList = $("chatList");
const sidebar = $("sidebar");
const voiceStatus = $("voiceStatus");
const toast = $("toast");

const STORAGE_KEY = "wolfs-ai-chats-v1";

let chats = loadChats();
let activeId = null;
let busy = false;
let recognition = null;
let listening = false;
let toastTimer;

function makeId() {
  return Date.now().toString(36) +
    Math.random().toString(36).slice(2, 8);
}

function loadChats() {
  try {
    const data = JSON.parse(
      localStorage.getItem(STORAGE_KEY) || "[]"
    );

    if (!Array.isArray(data)) return [];

    return data.filter(c =>
      c &&
      typeof c.id === "string" &&
      typeof c.title === "string" &&
      Array.isArray(c.messages) &&
      c.messages.length <= 200 &&
      c.messages.every(m =>
        m &&
        ["user", "assistant"].includes(m.role) &&
        typeof m.content === "string" &&
        m.content.length <= 4000
      )
    ).slice(0, 50);
  } catch {
    return [];
  }
}

function saveChats() {
  try {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify(chats.slice(0, 50))
    );
  } catch {
    notify("Պահպանումը չհաջողվեց։ Հնարավոր է՝ հիշողությունը լիքն է։");
  }
}

function notify(text) {
  toast.textContent = text;
  toast.classList.add("show");

  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    toast.classList.remove("show");
  }, 2800);
}

function currentChat() {
  return chats.find(c => c.id === activeId) || null;
}

function createChat() {
  const chat = {
    id: makeId(),
    title: "Նոր զրույց",
    messages: [],
    updatedAt: Date.now()
  };

  chats.unshift(chat);
  chats = chats.slice(0, 50);
  activeId = chat.id;

  saveChats();
  renderHistory();
  renderMessages();
  closeMenu();
}

function renderHistory() {
  chatList.replaceChildren();

  if (!chats.length) {
    const empty = document.createElement("p");
    empty.className = "empty-history";
    empty.textContent = "Քո զրույցները կհայտնվեն այստեղ։";
    chatList.appendChild(empty);
    return;
  }

  chats.forEach(chat => {
    const row = document.createElement("div");
    row.className = "history-item";

    const select = document.createElement("button");
    select.className = "history-select" +
      (chat.id === activeId ? " active" : "");
    select.textContent = "💬 " + chat.title;
    select.title = chat.title;
    select.setAttribute("aria-current",
      chat.id === activeId ? "page" : "false");

    select.addEventListener("click", () => {
      if (busy) return;
      activeId = chat.id;
      renderHistory();
      renderMessages();
      closeMenu();
    });

    const del = document.createElement("button");
    del.className = "history-delete";
    del.textContent = "×";
    del.title = "Ջնջել զրույցը";
    del.setAttribute("aria-label", "Ջնջել " + chat.title);

    del.addEventListener("click", () => {
      if (busy) return;

      if (!confirm("Ջնջե՞լ այս զրույցը։")) return;

      chats = chats.filter(c => c.id !== chat.id);

      if (activeId === chat.id) {
        activeId = null;
      }

      saveChats();

      if (!activeId && chats.length) {
        activeId = chats[0].id;
      }

      renderHistory();
      renderMessages();
      notify("Զրույցը ջնջվեց։");
    });

    row.append(select, del);
    chatList.appendChild(row);
  });
}

function addBubble(role, text) {
  const wrapper = document.createElement("div");
  wrapper.className = "message " + role;

  const label = document.createElement("div");
  label.className = "message-label";
  label.textContent =
    role === "user" ? "👤 Դու" : "🐺 WOLFS AI";

  const bubble = document.createElement("div");
  bubble.className = "bubble";
  bubble.textContent = text;

  wrapper.append(label, bubble);
  messagesBox.appendChild(wrapper);

  return bubble;
}

function renderMessages() {
  messagesBox.replaceChildren();

  const chat = currentChat();
  const hasMessages = Boolean(
    chat && chat.messages.length
  );

  welcome.hidden = hasMessages;

  if (!hasMessages) {
    if (chat) {
      addBubble(
        "assistant",
        "Բարև՛։ Ես WOLFS AI-ն եմ։ Ի՞նչ հարց ունես։ 🐺"
      );
    }
    return;
  }

  chat.messages.forEach(m => {
    addBubble(m.role === "user" ? "user" : "assistant",
      m.content);
  });

  scrollToBottom();
}

function scrollToBottom() {
  messagesBox.lastElementChild?.scrollIntoView({
    behavior: "smooth",
    block: "end"
  });
}

function closeMenu() {
  sidebar.classList.remove("open");
}

function addToHistory(role, content) {
  const chat = currentChat();
  if (!chat) return;

  chat.messages.push({ role, content });

  if (role === "user" && chat.title === "Նոր զրույց") {
    chat.title = content.replace(/\s+/g, " ").slice(0, 35);
    if (content.length > 35) chat.title += "…";
  }

  chat.updatedAt = Date.now();

  chats.sort((a, b) => b.updatedAt - a.updatedAt);
  saveChats();
  renderHistory();
}

async function askAI(text) {
  const question = text.trim();

  if (!question || busy) return;

  if (question.length > 4000) {
    notify("Հարցը չափազանց երկար է։");
    return;
  }

  if (!activeId || !currentChat()) {
    createChat();
  }

  const chat = currentChat();

  busy = true;
  sendBtn.disabled = true;
  micBtn.disabled = true;
  promptBox.disabled = true;

  welcome.hidden = true;

  addToHistory("user", question);
  addBubble("user", question);

  const answerBubble = addBubble(
    "assistant",
    "Մտածում եմ…"
  );

  scrollToBottom();

  try {
    // Ուղարկում ենք միայն ընթացիկ զրույցի վերջին հաղորդագրությունները։
    const messages = chat.messages.slice(-20);

    const response = await fetch("/api/chat", {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ messages })
    });

    const data = await response.json();

    if (!response.ok) {
      throw new Error(
        data.error || "Սերվերի հարցումը չհաջողվեց։"
      );
    }

    const answer = String(data.reply || "Պատասխան չստացվեց։");

    answerBubble.textContent = answer;
    addToHistory("assistant", answer);

  } catch (error) {
    answerBubble.textContent =
      "⚠️ " + (error.message || "Կապի սխալ։");

    // Չպահել անհաջող հարցումը որպես ավարտված զրույց։
    const c = currentChat();
    if (c) {
      c.messages = c.messages.filter(
        m => !(m.role === "user" && m.content === question)
      );
      saveChats();
      renderHistory();
    }

    notify("Չհաջողվեց ստանալ պատասխանը։");
  } finally {
    busy = false;
    sendBtn.disabled = false;
    micBtn.disabled = false;
    promptBox.disabled = false;
    promptBox.focus();
    scrollToBottom();
  }
}

form.addEventListener("submit", async event => {
  event.preventDefault();

  if (busy) return;

  const text = promptBox.value.trim();
  if (!text) return;

  promptBox.value = "";
  promptBox.style.height = "auto";

  await askAI(text);
});

promptBox.addEventListener("input", () => {
  promptBox.style.height = "auto";
  promptBox.style.height =
    Math.min(promptBox.scrollHeight, 160) + "px";
});

promptBox.addEventListener("keydown", event => {
  if (
    event.key === "Enter" &&
    !event.shiftKey &&
    !event.isComposing
  ) {
    event.preventDefault();
    form.requestSubmit();
  }
});

$("newChat").addEventListener("click", () => {
  if (busy) return;
  createChat();
  promptBox.focus();
});

$("menuBtn").addEventListener("click", () => {
  sidebar.classList.toggle("open");
});

document.querySelectorAll("[data-question]").forEach(button => {
  button.addEventListener("click", () => {
    askAI(button.dataset.question);
  });
});

// Խոսափողի աջակցություն բրաուզերում։
const SpeechRecognition =
  window.SpeechRecognition ||
  window.webkitSpeechRecognition;

if (SpeechRecognition) {
  recognition = new SpeechRecognition();
  recognition.lang = "hy-AM";
  recognition.continuous = false;
  recognition.interimResults = true;
  recognition.maxAlternatives = 1;

  recognition.onstart = () => {
    listening = true;
    micBtn.classList.add("listening");
    voiceStatus.textContent = "🎤 Լսում եմ քեզ…";
  };

  recognition.onresult = event => {
    let transcript = "";

    for (let i = event.resultIndex;
         i < event.results.length; i++) {
      transcript += event.results[i][0].transcript;
    }

    promptBox.value = transcript;
    promptBox.dispatchEvent(new Event("input"));
  };

  recognition.onerror = event => {
    const errors = {
      "not-allowed": "Թույլատրի՛ր խոսափողի օգտագործումը բրաուզերում։",
      "no-speech": "Ձայն չլսվեց։ Փորձիր նորից։",
      "network": "Ձայնի ճանաչման ցանցային սխալ։"
    };

    voiceStatus.textContent =
      errors[event.error] || "Խոսափողի սխալ։";
  };

  recognition.onend = () => {
    listening = false;
    micBtn.classList.remove("listening");

    if (voiceStatus.textContent === "🎤 Լսում եմ քեզ…") {
      voiceStatus.textContent = "Ձայնը ճանաչվեց։ Կարող ես խմբագրել և ուղարկել։";
    }
  };

  micBtn.addEventListener("click", () => {
    if (busy) return;

    if (listening) {
      recognition.stop();
      return;
    }

    try {
      voiceStatus.textContent = "";
      recognition.start();
    } catch {
      notify("Չհաջողվեց միացնել խոսափողը։");
    }
  });
} else {
  micBtn.addEventListener("click", () => {
    notify("Այս բրաուզերը չի աջակցում ձայնի ճանաչմանը։ Փորձիր Chrome-ում։");
  });
  micBtn.title = "Ձայնի ճանաչումը հասանելի չէ";
}

renderHistory();

if (chats.length) {
  activeId = chats[0].id;
  renderHistory();
  renderMessages();
}
