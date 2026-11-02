(function () {
  "use strict";

  const db = firebase.firestore();
  const auth = firebase.auth();

  const form = document.getElementById("voteForm");
  const seminarSelect = document.getElementById("seminar");
  const presDiv = document.getElementById("presentations");
  const message = document.getElementById("message");

  const allowedSeminars = [
    "Seminar 1", "Seminar 2", "Seminar 3",
    "Seminar 4", "Seminar 6", "Seminar 7"
  ];

  function isAuthorized(user) {
    if (!user || !user.emailVerified || !user.email) return false;

    const email = user.email.toLowerCase();
    return email.endsWith("@natur.cuni.cz") ||
           email.endsWith("@uochb.cas.cz");
  }

  // Exact UTC boundaries mirror the deployed Firestore rules.
  // Display dates are formatted in Europe/Prague, independently of the device timezone.
  const votingWindows = {
    "Seminar 1": ["2026-11-12T23:00:00Z", "2026-11-19T23:00:00Z"],
    "Seminar 2": ["2026-12-10T23:00:00Z", "2026-12-17T23:00:00Z"],
    "Seminar 3": ["2027-01-14T23:00:00Z", "2027-01-21T23:00:00Z"],
    "Seminar 4": ["2027-02-11T23:00:00Z", "2027-02-18T23:00:00Z"],
    "Seminar 6": ["2027-04-15T22:00:00Z", "2027-04-22T22:00:00Z"],
    "Seminar 7": ["2027-05-13T22:00:00Z", "2027-05-20T22:00:00Z"]
  };

  const submitButton = form.querySelector('button[type="submit"]');
  const status = document.createElement("p");
  status.id = "votingWindowStatus";
  status.setAttribute("role", "status");
  status.setAttribute("aria-live", "polite");
  submitButton.parentNode.insertBefore(status, submitButton);
  let submitting = false;
  const completedInSession = new Set();

  function formatPrague(iso) {
    return new Intl.DateTimeFormat("en-GB", {
      timeZone: "Europe/Prague", day: "numeric", month: "long", year: "numeric",
      hour: "2-digit", minute: "2-digit", hourCycle: "h23"
    }).format(new Date(iso)) + " (Prague time)";
  }

  function windowState(seminar, now = Date.now()) {
    if (!votingWindows[seminar]) return "unselected";
    const [open, close] = votingWindows[seminar].map(Date.parse);
    if (now < open) return "upcoming";
    if (now >= close) return "closed";
    return "open";
  }

  function refreshVotingWindow() {
    const seminar = seminarSelect.value;
    const state = windowState(seminar);
    const authorized = isAuthorized(auth.currentUser);
    const alreadySubmitted = completedInSession.has(seminar);
    const enabled = authorized && state === "open" && !submitting && !alreadySubmitted;

    submitButton.disabled = !enabled;
    for (const control of presDiv.querySelectorAll("select, textarea, input")) {
      // Preserve the existing 'No comments' checkbox behavior.
      control.disabled = !enabled || (control.tagName === "TEXTAREA" &&
        document.getElementById(control.id.replace("comment", "nocmt"))?.checked);
    }

    if (alreadySubmitted) {
      status.textContent = "Your evaluation has been submitted in this session.";
    } else if (state === "unselected") {
      status.textContent = "Select a seminar to see its voting period.";
    } else if (state === "upcoming") {
      status.textContent = "Voting has not started yet. Opens " + formatPrague(votingWindows[seminar][0]) + ".";
    } else if (state === "closed") {
      status.textContent = "Voting is closed. Closed " + formatPrague(votingWindows[seminar][1]) + ".";
    } else {
      status.textContent = "Voting is open until " + formatPrague(votingWindows[seminar][1]) + ".";
    }
    return enabled;
  }

  function updateVotingAccess() {
    const authorized = isAuthorized(auth.currentUser);
    form.style.display = authorized ? "block" : "none";
    if (!authorized) {
      seminarSelect.value = "";
      presDiv.replaceChildren();
    }
    refreshVotingWindow();
  }

  function renderPresentations(seminar) {
    presDiv.replaceChildren();

    if (!allowedSeminars.includes(seminar)) return;

    const names = window.SEMINARS[seminar].presenters;

    names.forEach((name, i) => {
      const block = document.createElement("div");
      block.className = "presentation-block";

      const heading = document.createElement("h3");
      heading.textContent = name;
      block.appendChild(heading);

      const scoreLabel = document.createElement("label");
      scoreLabel.htmlFor = `pres${i + 1}`;
      scoreLabel.textContent = "Score (1 = worst, 10 = best)";
      block.appendChild(scoreLabel);

      const scoreSelect = document.createElement("select");
      scoreSelect.id = `pres${i + 1}`;
      scoreSelect.required = true;
      scoreSelect.add(new Option("-- Select --", ""));

      for (let score = 1; score <= 10; score++) {
        scoreSelect.add(new Option(String(score), String(score)));
      }

      block.appendChild(scoreSelect);

      const commentLabel = document.createElement("label");
      commentLabel.htmlFor = `comment${i + 1}`;
      commentLabel.textContent = "Comment (optional)";
      block.appendChild(commentLabel);

      const textarea = document.createElement("textarea");
      textarea.id = `comment${i + 1}`;
      textarea.rows = 3;
      textarea.maxLength = 2000;
      block.appendChild(textarea);

      presDiv.appendChild(block);
    });
    refreshVotingWindow();
  }

  seminarSelect.addEventListener("change", () => {
    renderPresentations(seminarSelect.value);
    message.textContent = "";
    refreshVotingWindow();
  });

  window.updateVotingAccess = updateVotingAccess;
  auth.onAuthStateChanged(updateVotingAccess);
  // Keep the display current when a voting period starts or closes.
  setInterval(refreshVotingWindow, 30000);
  document.addEventListener("visibilitychange", refreshVotingWindow);

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    message.textContent = "";

    const user = auth.currentUser;

    if (!isAuthorized(user)) {
      message.textContent = "Please sign in with a verified institutional email.";
      message.className = "error";
      updateVotingAccess();
      return;
    }

    const seminar = seminarSelect.value;

    if (!allowedSeminars.includes(seminar)) {
      message.textContent = "Please select a valid seminar.";
      message.className = "error";
      return;
    }

    if (!refreshVotingWindow()) {
      message.textContent = "Voting is not available for this seminar at the moment.";
      message.className = "error";
      return;
    }

    const names = window.SEMINARS[seminar].presenters;
    const presentations = [];

    for (let i = 0; i < names.length; i++) {
      const score = Number(document.getElementById(`pres${i + 1}`).value);
      const comment = document.getElementById(`comment${i + 1}`).value.trim();

      if (!Number.isInteger(score) || score < 1 || score > 10) {
        message.textContent = "Please score every presentation from 1 to 10.";
        message.className = "error";
        return;
      }

      presentations.push({
        name: names[i],
        score,
        comment
      });
    }

    const seminarNumber = seminar.split(" ")[1];
    const voteId = `Seminar_${seminarNumber}_${user.uid}`;

    if (submitButton.disabled) return;
    submitting = true;
    refreshVotingWindow();
    try {
      const docRef = db.collection("votes_2026_2027").doc(voteId);

      await docRef.set({
        participant: user.email,
        uid: user.uid,
        seminar,
        presentations,
        timestamp: firebase.firestore.FieldValue.serverTimestamp()
      });

      completedInSession.add(seminar);
      message.textContent = "Evaluation submitted successfully. Thank you!";
      message.className = "success";
      form.reset();
      presDiv.replaceChildren();

    } catch (error) {
      console.error(error);

      message.textContent =
        "The vote could not be submitted. You may have already voted, " +
        "or voting for this seminar is not currently open.";

      message.className = "error";
    } finally {
      submitting = false;
      refreshVotingWindow();
    }
  });
})();
