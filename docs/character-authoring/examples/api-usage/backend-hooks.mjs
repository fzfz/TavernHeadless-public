export function derive({ candidate }) {
  const next = { ...candidate };
  next.level = Math.floor(next.score / 10);
  return next;
}

export function validate({ before, candidate }) {
  return {
    issues:
      candidate.score < before.score
        ? [
            {
              path: "/score",
              code: "SCORE_DECREASED",
              message: "积分低于更新前值，请检查本轮积分变化规则。",
            },
          ]
        : [],
  };
}

export function renderController({ variables }) {
  return { text: `当前地点：${variables.location}。` };
}
