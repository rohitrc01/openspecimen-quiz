const BACKEND_URL = "https://openspecimen-quiz.onrender.com"; // your Render backend

let ws;
function connectWS() {
  try {
    ws = new WebSocket(BACKEND_URL.replace(/^http/, "ws") + "/ws");
    ws.onopen = () => console.log("WebSocket connected");
    ws.onmessage = (evt) => {
      const data = JSON.parse(evt.data);
      if (data.type === "question_start") {
        onQuestionStart(data.question);
      } else if (data.type === "leaderboard_update") {
        updateLeaderboardUI(data.leaderboard);
      }
    };
    ws.onclose = () => {
      console.log("WS closed, reconnecting...");
      setTimeout(connectWS, 2000);
    };
  } catch (err) {
    console.error("WebSocket error", err);
  }
}
connectWS();

async function apiFetch(path, opts) {
  const res = await fetch(BACKEND_URL + path + "?ts=" + Date.now(), opts);
  if (!res.ok) throw new Error(await res.text());
  return res;
}

/* ============================
   PLAYER PAGE (index.html)
   ============================ */
if (document.getElementById("join-btn")) {
  const joinBtn = document.getElementById("join-btn");
  const playerNameInput = document.getElementById("player-name");
  const joinScreen = document.getElementById("join-screen");
  const quizScreen = document.getElementById("quiz-screen");
  const questionText = document.getElementById("question-text");
  const optionsDiv = document.getElementById("options");
  const timerSpan = document.getElementById("time-left");
  const statusDiv = document.getElementById("status");
  const scoreVal = document.getElementById("score-val");

  let playerName = "";
  let currentQuestion = null;
  let localTimer = null;
  let localTimeLeft = 15;

  joinBtn.addEventListener("click", () => {
    const name = playerNameInput.value.trim();
    if (!name) return alert("Enter your name first!");
    playerName = name;
    joinScreen.style.display = "none";
    quizScreen.style.display = "block";
    statusDiv.innerText = "Waiting for host to start a question...";
  });

  function onQuestionStart(question) {
    currentQuestion = question;
    questionText.innerText = question.question;
    optionsDiv.innerHTML = "";
    question.options.forEach((opt, idx) => {
      const btn = document.createElement("button");
      btn.innerText = opt;
      btn.onclick = () => submitAnswer(idx);
      optionsDiv.appendChild(btn);
    });

    // Reset and start timer (15 seconds)
    if (localTimer) clearInterval(localTimer);
    localTimeLeft = 15;
    timerSpan.innerText = localTimeLeft;
    timerSpan.classList.remove("red");

    localTimer = setInterval(() => {
      localTimeLeft--;
      timerSpan.innerText = localTimeLeft;
      if (localTimeLeft <= 3) timerSpan.classList.add("red");
      if (localTimeLeft <= 0) {
        clearInterval(localTimer);
        disableOptions("⏰ Time up! No answer recorded.");
      }
    }, 1000);

    statusDiv.innerText = "Answer now!";
  }

  async function submitAnswer(chosenIndex) {
    if (!currentQuestion) return;
    clearInterval(localTimer);
    disableOptions("Submitting...");
    try {
      const body = {
        name: playerName,
        qid: currentQuestion.id,
        chosen_index: chosenIndex,
        time_taken: 15 - localTimeLeft
      };
      await apiFetch("/submit_answer", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body)
      });
      statusDiv.innerText = "✅ Answer submitted!";
      fetchLeaderboard();
    } catch (err) {
      console.error(err);
      statusDiv.innerText = "Submission failed!";
    }
  }

  async function fetchLeaderboard() {
    try {
      const res = await apiFetch("/leaderboard");
      const data = await res.json();
      const me = data.find(x => x[0] === playerName);
      if (me) scoreVal.innerText = me[1];
    } catch (err) {
      console.error("Leaderboard fetch failed", err);
    }
  }

  function disableOptions(msg) {
    optionsDiv.querySelectorAll("button").forEach(b => b.disabled = true);
    statusDiv.innerText = msg;
  }

  window.onQuestionStart = onQuestionStart;
}

/* ============================
   HOST PAGE (host.html)
   ============================ */
if (document.getElementById("start-q")) {
  const qSelect = document.getElementById("question-select");
  const startBtn = document.getElementById("start-q");
  const leaderboardOl = document.getElementById("leaderboard");

  (async () => {
    const res = await apiFetch("/questions");
    const qs = await res.json();
    qs.forEach(q => {
      const opt = document.createElement("option");
      opt.value = q.id;
      opt.innerText = `Q${q.id}: ${q.question.substring(0, 70)}...`;
      qSelect.appendChild(opt);
    });
  })();

  startBtn.addEventListener("click", async () => {
    const qid = qSelect.value;
    if (!qid) return alert("Select a question");
    startBtn.disabled = true;
    await apiFetch(`/host/start_question?qid=${qid}`, { method: "POST" });
    setTimeout(() => (startBtn.disabled = false), 1000);
  });

  function updateLeaderboardUI(lb) {
    leaderboardOl.innerHTML = "";
    lb.forEach(item => {
      const li = document.createElement("li");
      li.innerText = `${item[0]} — ${item[1]} pts`;
      leaderboardOl.appendChild(li);
    });
  }

  window.updateLeaderboardUI = updateLeaderboardUI;
}
