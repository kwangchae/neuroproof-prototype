function numberOrNull(value) {
  return Number.isFinite(value) ? value : null;
}

function riskLabelsForAnalysis(analysis) {
  const bandSummary = analysis && analysis.bandSummary ? analysis.bandSummary : {};
  const focusIndex = numberOrNull(bandSummary.focusIndex);
  const relaxationIndex = numberOrNull(bandSummary.relaxationIndex);
  const labels = [
    {
      id: "raw-eeg-linkability",
      level: "high",
      title: "Raw EEG linkability",
      description: "Raw neural signals can be identifying, so the prototype keeps EEG files off-chain."
    }
  ];

  if (focusIndex !== null && focusIndex >= 0.7) {
    labels.push({
      id: "focus-inference",
      level: "medium",
      title: "Focus-state inference",
      description: "The beta/alpha ratio can expose attention-related derived information."
    });
  }

  if (relaxationIndex !== null) {
    labels.push({
      id: "relaxation-inference",
      level: relaxationIndex < 0.7 ? "medium" : "low",
      title: "Relaxation-state inference",
      description: "The alpha/(beta+theta) ratio can expose relaxation-related derived information."
    });
  }

  return labels;
}

module.exports = {
  riskLabelsForAnalysis
};
