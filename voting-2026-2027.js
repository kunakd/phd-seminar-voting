
(function () {
  "use strict";

  const db = firebase.firestore();
  const auth = firebase.auth();

  const form = document.getElementById("voteForm");
  const seminarSelect = document.getElementById("seminar");
  const presDiv = document.getElementById("presentations");
  const message = document.getElementById("message");
  const submitButton = form.querySelector(
    'button[type="submit"]'
  );

  const allowedSeminars = [
    "Seminar 1",
    "Seminar 2",
    "Seminar 3",
    "Seminar 4",
    "Seminar 6",
    "Seminar 7"
  ];

  const votingWindows = {
    "Seminar 1": [
      "2026-11-12T23:00:00Z",
      "2026-11-19T23:00:00Z"
    ],
    "Seminar 2": [
      "2026-12-10T23:00:00Z",
      "2026-12-17T23:00:00Z"
    ],
    "Seminar 3": [
      "2027-01-14T23:00:00Z",
      "2027-01-21T23:00:00Z"
    ],
    "Seminar 4": [
      "2027-02-11T23:00:00Z",
      "2027-02-18T23:00:00Z"
    ],
    "Seminar 6": [
      "2027-04-15T22:00:00Z",
      "2027-04-22T22:00:00Z"
    ],
    "Seminar 7": [
      "2027-05-13T22:00:00Z",
      "2027-05-20T22:00:00Z"
    ]
  };

  const DRAFT_PREFIX = "phd-voting-draft-2026-2027";
  const MAX_DRAFT_AGE = 30 * 24 * 60 * 60 * 1000;

  let submitting = false;
  let currentUserUid = null;
  let storageAvailable = true;

  const completedInSession = new Set();

  const status = document.createElement("p");
  status.id = "votingWindowStatus";
  status.setAttribute("role", "status");
  status.setAttribute("aria-live", "polite");

  submitButton.parentNode.insertBefore(
    status,
    submitButton
  );

  function isAuthorized(user) {
    if (
      !user ||
      !user.emailVerified ||
      typeof user.email !== "string"
    ) {
      return false;
    }

    const email = user.email.toLowerCase();

    return (
      email.endsWith("@natur.cuni.cz") ||
      email.endsWith("@uochb.cas.cz")
    );
  }

  function validSeminar(seminar) {
    return (
      allowedSeminars.includes(seminar) &&
      window.SEMINARS &&
      window.SEMINARS[seminar] &&
      Array.isArray(window.SEMINARS[seminar].presenters)
    );
  }

  function draftKey(uid, seminar) {
    return [
      DRAFT_PREFIX,
      encodeURIComponent(uid),
      encodeURIComponent(seminar)
    ].join(":");
  }

  function readDraft(uid, seminar) {
    try {
      const raw = localStorage.getItem(
        draftKey(uid, seminar)
      );

      if (!raw) return null;

      const draft = JSON.parse(raw);

      if (
        !draft ||
        !Array.isArray(draft.presentations) ||
        !Number.isFinite(draft.savedAt) ||
        draft.savedAt > Date.now() + 60000 ||
        Date.now() - draft.savedAt > MAX_DRAFT_AGE
      ) {
        return null;
      }

      return draft;
    } catch (error) {
      console.warn("Could not read saved draft.");
      return null;
    }
  }

  function removeDraft(uid, seminar) {
    try {
      localStorage.removeItem(
        draftKey(uid, seminar)
      );
    } catch (error) {
      console.warn("Could not remove saved draft.");
    }
  }

  function collectDraft() {
    const seminar = seminarSelect.value;

    if (!validSeminar(seminar)) return null;

    const names = window.SEMINARS[seminar].presenters;

    if (
      presDiv.querySelectorAll("select").length !==
      names.length
    ) {
      return null;
    }

    return names.map((name, i) => ({
      name,
      score:
        document.getElementById(`pres${i + 1}`)?.value || "",
      comment:
        document.getElementById(`comment${i + 1}`)?.value || ""
    }));
  }

  function saveDraftFor(uid, seminar) {
    if (
      !uid ||
      !validSeminar(seminar) ||
      submitting ||
      completedInSession.has(seminar) ||
      seminarSelect.value !== seminar
    ) {
      return;
    }

    const presentations = collectDraft();

    if (!presentations) return;

    try {
      localStorage.setItem(
        draftKey(uid, seminar),
        JSON.stringify({
          savedAt: Date.now(),
          presentations
        })
      );

      storageAvailable = true;
    } catch (error) {
      storageAvailable = false;
      console.warn("Could not save voting draft.");
    }
  }

  function saveDraft() {
    const user = auth.currentUser;

    if (
      !isAuthorized(user) ||
      user.uid !== currentUserUid
    ) {
      return;
    }

    saveDraftFor(user.uid, seminarSelect.value);
  }

  function restoreDraft(seminar) {
    const user = auth.currentUser;

    if (
      !isAuthorized(user) ||
      user.uid !== currentUserUid ||
      !validSeminar(seminar) ||
      completedInSession.has(seminar)
    ) {
      return false;
    }

    const draft = readDraft(user.uid, seminar);

    if (!draft) return false;

    const names = window.SEMINARS[seminar].presenters;

    if (draft.presentations.length !== names.length) {
      return false;
    }

    for (let i = 0; i < names.length; i++) {
      const item = draft.presentations[i];

      if (!item || item.name !== names[i]) {
        return false;
      }
    }

    names.forEach((name, i) => {
      const item = draft.presentations[i];

      const score = document.getElementById(
        `pres${i + 1}`
      );

      const comment = document.getElementById(
        `comment${i + 1}`
      );

      const value = String(item.score);

      if (
        value === "" ||
        (
          /^[1-9]$|^10$/.test(value) &&
          Number.isInteger(Number(value))
        )
      ) {
        score.value = value;
      }

      if (typeof item.comment === "string") {
        comment.value = item.comment.slice(0, 2000);
      }
    });

    return true;
  }

  function formatPrague(iso) {
    return new Intl.DateTimeFormat("en-GB", {
      timeZone: "Europe/Prague",
      day: "numeric",
      month: "long",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23"
    }).format(new Date(iso)) + " (Prague time)";
  }

  function windowState(seminar, now = Date.now()) {
    if (!votingWindows[seminar]) {
      return "unselected";
    }

    const [open, close] =
      votingWindows[seminar].map(Date.parse);

    if (now < open) return "upcoming";
    if (now >= close) return "closed";

    return "open";
  }

  function refreshVotingWindow() {
    const seminar = seminarSelect.value;
    const state = windowState(seminar);
    const authorized = isAuthorized(auth.currentUser);

    const alreadySubmitted =
      completedInSession.has(seminar);

    const enabled =
      authorized &&
      state === "open" &&
      !submitting &&
      !alreadySubmitted;

    submitButton.disabled = !enabled;

    for (const control of presDiv.querySelectorAll(
      "select, textarea, input"
    )) {
      control.disabled = !enabled;
    }

    if (submitting) {
      status.textContent =
        "Submitting your evaluation. Please wait.";
    } else if (alreadySubmitted) {
      status.textContent =
        "Your evaluation was submitted successfully.";
    } else if (state === "unselected") {
      status.textContent =
        "Select a seminar to see its voting period.";
    } else if (state === "upcoming") {
      status.textContent =
        "Voting has not started yet. Opens " +
        formatPrague(votingWindows[seminar][0]) + ".";
    } else if (state === "closed") {
      status.textContent =
        "Voting is closed. Closed " +
        formatPrague(votingWindows[seminar][1]) + ".";
    } else {
      status.textContent =
        "Voting is open until " +
        formatPrague(votingWindows[seminar][1]) + ".";
    }

    return enabled;
  }

  function renderPresentations(seminar) {
    presDiv.replaceChildren();

    if (!validSeminar(seminar)) {
      refreshVotingWindow();
      return;
    }

    const names = window.SEMINARS[seminar].presenters;

    names.forEach((name, i) => {
      const block = document.createElement("div");
      block.className = "presentation-block";

      const heading = document.createElement("h3");
      heading.textContent = name;
      block.appendChild(heading);

      const scoreLabel = document.createElement("label");
      scoreLabel.htmlFor = `pres${i + 1}`;
      scoreLabel.textContent =
        "Score (1 = worst, 10 = best)";
      block.appendChild(scoreLabel);

      const scoreSelect = document.createElement("select");
      scoreSelect.id = `pres${i + 1}`;
      scoreSelect.required = true;

      scoreSelect.add(
        new Option("-- Select --", "")
      );

      for (let score = 1; score <= 10; score++) {
        scoreSelect.add(
          new Option(String(score), String(score))
        );
      }

      scoreSelect.addEventListener(
        "change",
        saveDraft
      );

      block.appendChild(scoreSelect);

      const commentLabel = document.createElement("label");
      commentLabel.htmlFor = `comment${i + 1}`;
      commentLabel.textContent =
        "Comment (optional)";
      block.appendChild(commentLabel);

      const textarea = document.createElement("textarea");
      textarea.id = `comment${i + 1}`;
      textarea.rows = 3;
      textarea.maxLength = 2000;

      textarea.addEventListener(
        "input",
        saveDraft
      );

      block.appendChild(textarea);
      presDiv.appendChild(block);
    });

    const restored = restoreDraft(seminar);

    if (restored) {
      message.textContent =
        "Your saved evaluation draft has been restored.";
      message.className = "success";
    }

    refreshVotingWindow();
  }

  function updateVotingAccess() {
    const user = auth.currentUser;
    const nextUid = user?.uid || null;

    if (currentUserUid !== nextUid) {
      // Preserve the previous account's draft
      // before clearing the form.
      if (currentUserUid && !submitting) {
        saveDraftFor(
          currentUserUid,
          seminarSelect.value
        );
      }

      presDiv.replaceChildren();
      seminarSelect.value = "";
      message.textContent = "";

      currentUserUid = nextUid;
    }

    const authorized = isAuthorized(user);

    form.style.display =
      authorized ? "block" : "none";

    if (!authorized) {
      presDiv.replaceChildren();
      seminarSelect.value = "";
    } else if (
      validSeminar(seminarSelect.value) &&
      !presDiv.children.length
    ) {
      renderPresentations(seminarSelect.value);
    }

    refreshVotingWindow();
  }

  seminarSelect.addEventListener("change", () => {
    if (submitting) return;

    message.textContent = "";
    renderPresentations(seminarSelect.value);
  });

  window.updateVotingAccess = updateVotingAccess;

  auth.onAuthStateChanged(updateVotingAccess);

  setInterval(refreshVotingWindow, 30000);

  document.addEventListener(
    "visibilitychange",
    () => {
      if (document.visibilityState === "hidden") {
        saveDraft();
      }

      refreshVotingWindow();
    }
  );

  window.addEventListener("pagehide", saveDraft);

  window.addEventListener("offline", () => {
    if (!submitting) {
      setMessage(
        "You are offline. Your evaluation draft is kept " +
        "on this device where browser storage is available.",
        true
      );
    }
  });

  function setMessage(text, error = false) {
    message.textContent = text;
    message.className = error ? "error" : "success";
  }

  function finishSubmission(uid, seminar) {
    completedInSession.add(seminar);
    removeDraft(uid, seminar);

    if (
      auth.currentUser?.uid === uid &&
      seminarSelect.value === seminar
    ) {
      form.reset();
      presDiv.replaceChildren();
    }

    setMessage(
      "Evaluation submitted successfully. Thank you!"
    );
  }

  form.addEventListener("submit", async event => {
    event.preventDefault();

    if (submitting) return;

    const user = auth.currentUser;
    const seminar = seminarSelect.value;

    if (!isAuthorized(user)) {
      setMessage(
        "Please sign in with a verified institutional email.",
        true
      );
      return;
    }

    if (!validSeminar(seminar)) {
      setMessage(
        "Please select a valid seminar.",
        true
      );
      return;
    }

    if (!refreshVotingWindow()) {
      setMessage(
        "Voting is not available for this seminar.",
        true
      );
      return;
    }

    const names = window.SEMINARS[seminar].presenters;
    const presentations = [];

    for (let i = 0; i < names.length; i++) {
      const scoreValue = document.getElementById(
        `pres${i + 1}`
      ).value;

      const score = Number(scoreValue);

      const comment = document.getElementById(
        `comment${i + 1}`
      ).value.trim();

      if (
        scoreValue === "" ||
        !Number.isInteger(score) ||
        score < 1 ||
        score > 10
      ) {
        setMessage(
          "Please score every presentation from 1 to 10.",
          true
        );
        return;
      }

      presentations.push({
        name: names[i],
        score,
        comment
      });
    }

    // Save before attempting a network operation.
    saveDraft();

    if (!navigator.onLine) {
      setMessage(
        "You are offline. Connect to the internet " +
        "before submitting your evaluation.",
        true
      );
      return;
    }

    const uid = user.uid;
    const voteId =
      `Seminar_${seminar.split(" ")[1]}_${uid}`;

    const docRef = db.collection(
      "votes_2026_2027"
    ).doc(voteId);

    submitting = true;
    refreshVotingWindow();

    setMessage(
      "Submitting your evaluation. Please wait."
    );

    try {
      await docRef.set({
        participant: user.email,
        uid,
        seminar,
        presentations,
        timestamp:
          firebase.firestore.FieldValue.serverTimestamp()
      });

      // The write promise resolved successfully.
      finishSubmission(uid, seminar);

    } catch (error) {
      console.error(
        "Voting submission failed:",
        error.code || error.message
      );

      if (
        error.code === "permission-denied" ||
        error.code === "already-exists"
      ) {
        setMessage(
          "The server rejected this submission. " +
          "You may have already voted, or voting may " +
          "be closed. Your draft has been preserved. " +
          "Please contact the organizer if necessary.",
          true
        );
      } else {
        setMessage(
          "Submission could not be confirmed. " +
          "Your draft has been preserved where browser " +
          "storage is available. Check your connection " +
          "before trying again. If you already submitted, " +
          "the server will not allow overwriting your vote.",
          true
        );
      }

    } finally {
      submitting = false;
      refreshVotingWindow();

      if (!storageAvailable) {
        console.warn(
          "Browser storage is unavailable; " +
          "draft recovery is not guaranteed."
        );
      }
    }
  });
})();
