
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
    "Seminar 1", "Seminar 2", "Seminar 3",
    "Seminar 4", "Seminar 6", "Seminar 7"
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
  let pendingSubmission = null;
  let currentUserUid = null;

  const completedInSession = new Set();

  const status = document.createElement("p");
  status.id = "votingWindowStatus";
  status.setAttribute("role", "status");
  status.setAttribute("aria-live", "polite");

  submitButton.parentNode.insertBefore(
    status, submitButton
  );

  function isAuthorized(user) {
    if (!user || !user.emailVerified || !user.email) {
      return false;
    }

    const email = user.email.toLowerCase();

    return (
      email.endsWith("@natur.cuni.cz") ||
      email.endsWith("@uochb.cas.cz")
    );
  }

  function draftKey(uid, seminar) {
    return [
      DRAFT_PREFIX,
      encodeURIComponent(uid),
      encodeURIComponent(seminar)
    ].join(":");
  }

  function getDraft(uid, seminar) {
    try {
      const raw = localStorage.getItem(
        draftKey(uid, seminar)
      );

      if (!raw) return null;

      const draft = JSON.parse(raw);

      if (
        !draft ||
        !Array.isArray(draft.presentations) ||
        typeof draft.savedAt !== "number" ||
        Date.now() - draft.savedAt > MAX_DRAFT_AGE
      ) {
        return null;
      }

      return draft;
    } catch (error) {
      console.warn("Unable to load voting draft.");
      return null;
    }
  }

  function saveDraft() {
    const user = auth.currentUser;
    const seminar = seminarSelect.value;

    if (
      !isAuthorized(user) ||
      !allowedSeminars.includes(seminar) ||
      submitting ||
      completedInSession.has(seminar)
    ) {
      return;
    }

    const names = window.SEMINARS[seminar].presenters;

    const presentations = names.map((name, i) => ({
      name,
      score: document.getElementById(
        `pres${i + 1}`
      )?.value || "",
      comment: document.getElementById(
        `comment${i + 1}`
      )?.value || ""
    }));

    try {
      localStorage.setItem(
        draftKey(user.uid, seminar),
        JSON.stringify({
          savedAt: Date.now(),
          presentations
        })
      );
    } catch (error) {
      console.warn("Unable to save voting draft.");
    }
  }

  function restoreDraft(seminar) {
    const user = auth.currentUser;

    if (!isAuthorized(user)) return;

    const draft = getDraft(user.uid, seminar);

    if (!draft) return;

    const names = window.SEMINARS[seminar].presenters;

    for (let i = 0; i < names.length; i++) {
      const item = draft.presentations[i];

      if (!item || item.name !== names[i]) continue;

      const score = document.getElementById(
        `pres${i + 1}`
      );

      const comment = document.getElementById(
        `comment${i + 1}`
      );

      if (
        score &&
        (
          item.score === "" ||
          (
            Number.isInteger(Number(item.score)) &&
            Number(item.score) >= 1 &&
            Number(item.score) <= 10
          )
        )
      ) {
        score.value = String(item.score);
      }

      if (
        comment &&
        typeof item.comment === "string"
      ) {
        comment.value = item.comment.slice(0, 2000);
      }
    }

    message.textContent =
      "Your saved evaluation draft has been restored.";
    message.className = "success";
  }

  function clearDraft(uid, seminar) {
    try {
      localStorage.removeItem(
        draftKey(uid, seminar)
      );
    } catch (error) {
      console.warn("Unable to clear voting draft.");
    }
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
    if (!votingWindows[seminar]) return "unselected";

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

    if (alreadySubmitted) {
      status.textContent =
        "Your evaluation has been submitted.";
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
      scoreLabel.textContent =
        "Score (1 = worst, 10 = best)";
      block.appendChild(scoreLabel);

      const scoreSelect = document.createElement("select");
      scoreSelect.id = `pres${i + 1}`;
      scoreSelect.required = true;
      scoreSelect.add(new Option("-- Select --", ""));

      for (let score = 1; score <= 10; score++) {
        scoreSelect.add(
          new Option(String(score), String(score))
        );
      }

      scoreSelect.addEventListener(
        "change", saveDraft
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
        "input", saveDraft
      );

      block.appendChild(textarea);
      presDiv.appendChild(block);
    });

    restoreDraft(seminar);
    refreshVotingWindow();
  }

  function updateVotingAccess() {
    const user = auth.currentUser;
    const authorized = isAuthorized(user);

    if (
      currentUserUid &&
      user?.uid !== currentUserUid
    ) {
      presDiv.replaceChildren();
      seminarSelect.value = "";
    }

    currentUserUid = user?.uid || null;

    form.style.display =
      authorized ? "block" : "none";

    if (!authorized) {
      presDiv.replaceChildren();
      seminarSelect.value = "";
    } else if (
      allowedSeminars.includes(seminarSelect.value) &&
      !presDiv.children.length
    ) {
      renderPresentations(seminarSelect.value);
    }

    refreshVotingWindow();
  }

  seminarSelect.addEventListener("change", () => {
    renderPresentations(seminarSelect.value);
    message.textContent = "";
    refreshVotingWindow();
  });

  window.updateVotingAccess = updateVotingAccess;

  auth.onAuthStateChanged(updateVotingAccess);

  setInterval(refreshVotingWindow, 30000);

  document.addEventListener(
    "visibilitychange", refreshVotingWindow
  );

  window.addEventListener("pagehide", saveDraft);

  async function confirmSubmission(docRef) {
    try {
      const snapshot = await docRef.get({
        source: "server"
      });

      return snapshot.exists;
    } catch (error) {
      return false;
    }
  }

  form.addEventListener("submit", async event => {
    event.preventDefault();
    message.textContent = "";

    const user = auth.currentUser;
    const seminar = seminarSelect.value;

    if (!isAuthorized(user)) {
      message.textContent =
        "Please sign in with a verified institutional email.";
      message.className = "error";
      return;
    }

    if (!allowedSeminars.includes(seminar)) {
      message.textContent =
        "Please select a valid seminar.";
      message.className = "error";
      return;
    }

    if (!refreshVotingWindow()) {
      message.textContent =
        "Voting is not available for this seminar.";
      message.className = "error";
      return;
    }

    const names = window.SEMINARS[seminar].presenters;
    const presentations = [];

    for (let i = 0; i < names.length; i++) {
      const score = Number(
        document.getElementById(
          `pres${i + 1}`
        ).value
      );

      const comment = document.getElementById(
        `comment${i + 1}`
      ).value.trim();

      if (
        !Number.isInteger(score) ||
        score < 1 ||
        score > 10
      ) {
        message.textContent =
          "Please score every presentation from 1 to 10.";
        message.className = "error";
        return;
      }

      presentations.push({
        name: names[i],
        score,
        comment
      });
    }

    const voteId =
      `Seminar_${seminar.split(" ")[1]}_${user.uid}`;

    const docRef = db.collection(
      "votes_2026_2027"
    ).doc(voteId);

    submitting = true;
    pendingSubmission = { seminar, uid: user.uid };
    refreshVotingWindow();

    try {
      await docRef.set({
        participant: user.email,
        uid: user.uid,
        seminar,
        presentations,
        timestamp:
          firebase.firestore.FieldValue.serverTimestamp()
      });

      completedInSession.add(seminar);
      clearDraft(user.uid, seminar);

      message.textContent =
        "Evaluation submitted successfully. Thank you!";
      message.className = "success";

      form.reset();
      presDiv.replaceChildren();

    } catch (error) {
      console.error("Voting submission error:", error);

      const confirmed = await confirmSubmission(docRef);

      if (confirmed) {
        completedInSession.add(seminar);
        clearDraft(user.uid, seminar);

        message.textContent =
          "Your evaluation was received successfully.";
        message.className = "success";

        form.reset();
        presDiv.replaceChildren();
      } else {
        message.textContent =
          "Submission could not be confirmed. " +
          "Your evaluation is saved on this device. " +
          "Please check your connection and try again.";
        message.className = "error";

        // Preserve the draft for retry.
        submitting = false;
        saveDraft();
      }
    } finally {
      submitting = false;
      pendingSubmission = null;
      refreshVotingWindow();
    }
  });
})();
