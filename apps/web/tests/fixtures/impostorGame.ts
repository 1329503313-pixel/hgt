import type { OnlineImpostorGame } from "../../src/shared/types";

export function impostorFixture(phase: OnlineImpostorGame["phase"] = "night"): OnlineImpostorGame {
  return {
    gameNumber: 1, phase, day: 1, missionSize: 2, successes: 0, failures: 0,
    deadlineAt: phase === "day_ready" ? null : new Date(Date.now() + 120_000).toISOString(),
    readyUserIds: [], playerSeats: ["u1", "u2", "u3", "u4"].map((userId, index) => ({ userId, seat: index + 1 })),
    isolatedUserIds: [], nomination: { attempt: 1, lockedUserIds: [], candidateUserIds: ["u1", "u2", "u3", "u4"], required: 2, submittedUserIds: [] },
    missionTeamUserIds: ["u1", "u2"], missionSubmittedUserIds: [], publicClues: [],
    accusation: { attempt: 1, candidateUserIds: ["u1", "u2", "u3", "u4"], submittedUserIds: [] },
    winner: null, endReason: null, revealedImpostorSeat: 1, history: [], roleReveal: null,
    me: { seat: 1, role: "detective", roleLabel: "侦探", readySubmitted: false,
      nightActionTypes: ["guard", "investigate", "skip"], nightActionTargetCounts: { guard: 1, investigate: 2, skip: 0 },
      nightSubmitted: false, investigation: null, clueSubmitted: false, nominationSubmitted: false,
      missionChoiceSubmitted: false, accusationSubmitted: false, canAssassinate: true, canStartAssassination: false },
  };
}
