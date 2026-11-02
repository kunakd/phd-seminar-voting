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

  function updateVotingAccess() {
    const user = auth.currentUser;
    const authorized = isAuthorized(user);

    form.style.display = authorized ? "block" : "none";

    if (!authorized) {
      seminarSelect.value = "";
      presDiv.replaceChildren();
    }
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
  }

  seminarSelect.addEventListener("change", () => {
    renderPresentations(seminarSelect.value);
    message.textContent = "";
  });

  window.updateVotingAccess = updateVotingAccess;
  auth.onAuthStateChanged(updateVotingAccess);

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

    const submitButton = form.querySelector('button[type="submit"]');
    if (submitButton.disabled) return;
    submitButton.disabled = true;
    try {
      const docRef = db.collection("votes_2026_2027").doc(voteId);

      await docRef.set({
        participant: user.email,
        uid: user.uid,
        seminar,
        presentations,
        timestamp: firebase.firestore.FieldValue.serverTimestamp()
      });

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
      submitButton.disabled = false;
    }
  });
})();
