/**********************************************
 OPEN SPECIMEN QUIZ — FINAL FIXED SCRIPT.JS
 Supports Vercel + Render + WSS WebSockets
**********************************************/

// BACKEND URL (Render)
const BACKEND_URL = "https://openspecimen-quiz.onrender.com";

// SECURE WebSocket URL — FIXED VERSION (HTTPS → WSS)
function getWSUrl() {
  return BACKEND_URL.replace("https://", "wss://") + "/ws";
}

/**********************************************
  WEBSOCKET CONNECTION 
**********************************************/
let ws;

function connectWS() {
  try {
    ws = new WebSocket(getWSUrl());

    ws.onopen = () => {
      console.log("WS CONNECTED ✔", getWSUrl());
    };

    ws.onmessage = (evt) => {
      const data = JSON.parse(evt.data);

      if (data.type === "question_start") {
        window.onQuestionStart?.(data.question);
      }

      if (data.type === "leaderboard_update") {
        window.updateLeaderboardUI?.(data.leaderboard);
      }
    };

    ws.onclose = () => {
      console.log("WS DISCONNECTED — retrying…");
      setTimeout(connectWS, 1500);
    };

    ws.onerror = () => {
      console.log("WS ERROR — reconnecting…");
    };

  } catch (err) {
    console.error("WS Error:", err);
  }
}

connectWS();

/**********************************************
 UTILITY — API FETCH WITH NO-CACHE
**********************************************/
async function apiFetch(path, opts = {}) {
  let url = BACKEND_URL + path;

  // If URL already contains "?" → append using "&"
  if (url.includes("?")) {
    url += "&ts=" + Date.now();
  } else {
    url += "?ts=" + Date.now();
  }

  const res = await fetch(url, opts);
  if (!res.ok) throw new Error(await res.text());
  return res;
}


/**********************************************
 PLAYER PAGE LOGIC (index.html)
**********************************************/
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

  // JOIN QUIZ
  joinBtn.onclick = () => {
    const name = playerNameInput.value.trim();
    if (!name) return alert("Enter your name!");

    playerName = name;
    joinScreen.style.display = "none";
    quizScreen.style.display = "block";
    statusDiv.innerText = "Waiting for host...";
  };

  // HOST STARTS QUESTION
  window.onQuestionStart = function (question) {
    currentQuestion = question;

    questionText.innerText = question.question;
    optionsDiv.innerHTML = "";

    // render options
    question.options.forEach((opt, idx) => {
      const btn = document.createElement("button");
      btn.innerText = opt;
      btn.className = "opt-btn";
      btn.onclick = () => submitAnswer(idx);
      optionsDiv.appendChild(btn);
    });

    // RESET 15-second TIMER
    if (localTimer) clearInterval(localTimer);

    localTimeLeft = 15;
    timerSpan.innerText = localTimeLeft;
    timerSpan.classList.remove("red");

    localTimer = setInterval(() => {
      localTimeLeft--;
      timerSpan.innerText = localTimeLeft;

      if (localTimeLeft <= 3) {
        timerSpan.classList.add("red");
      }

      if (localTimeLeft <= 0) {
        clearInterval(localTimer);
        disableOptions("⏰ Time up!");
      }

    }, 1000);

    statusDiv.innerText = "Answer now!";
  };

  // DISABLE OPTIONS
  function disableOptions(msg) {
    optionsDiv.querySelectorAll("button").forEach(b => b.disabled = true);
    statusDiv.innerText = msg;
  }

  // SUBMIT ANSWER
  async function submitAnswer(chosenIdx) {
    if (!currentQuestion) return;

    clearInterval(localTimer);
    disableOptions("Submitting...");

    try {
      const payload = {
        name: playerName,
        qid: currentQuestion.id,
        chosen_index: chosenIdx,
        time_taken: 15 - localTimeLeft
      };

      await apiFetch("/submit_answer", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      });

      statusDiv.innerText = "✅ Answer submitted!";
      fetchLeaderboard();

    } catch (err) {
      console.error(err);
      statusDiv.innerText = "Submission failed!";
    }
  }

  // FETCH SCORE
  async function fetchLeaderboard() {
    try {
      const res = await apiFetch("/leaderboard");
      const data = await res.json();
      const me = data.find(x => x[0] === playerName);
      if (me) scoreVal.innerText = me[1];
    } catch (err) {
      console.error("Leaderboard error:", err);
    }
  }
}

/**********************************************
 HOST PAGE LOGIC (host.html)
**********************************************/
if (document.getElementById("start-q")) {

  const qSelect = document.getElementById("question-select");
  const startBtn = document.getElementById("start-q");
  const leaderboardOl = document.getElementById("leaderboard");

  // LOAD QUESTIONS
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

  // START QUESTION
  startBtn.onclick = async () => {
    const qid = qSelect.value;
    if (!qid) return alert("Select a question first.");

    startBtn.disabled = true;

    await apiFetch(`/host/start_question?qid=${qid}`, { method: "POST" });

    setTimeout(() => startBtn.disabled = false, 1000);
  };

  // UPDATE LEADERBOARD
  window.updateLeaderboardUI = function (lb) {
    leaderboardOl.innerHTML = "";
    lb.forEach(item => {
      const li = document.createElement("li");
      li.innerText = `${item[0]} — ${item[1]} pts`;
      leaderboardOl.appendChild(li);
    });
  };
}
