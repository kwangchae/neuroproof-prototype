const crypto = require("node:crypto");

function seededOffset(seed) {
  const hash = crypto.createHash("sha256").update(seed, "utf8").digest("hex");
  return (Number.parseInt(hash.slice(0, 8), 16) % 200001) - 100000;
}

function splitValue(metric, value, recordId) {
  const scaledValue = Math.round(value * 10000);
  const shareA = seededOffset(`${recordId}:${metric}:a`);
  const shareB = seededOffset(`${recordId}:${metric}:b`);
  const shareC = scaledValue - shareA - shareB;
  const shares = [
    { holder: "cloud-node-a", value: shareA },
    { holder: "cloud-node-b", value: shareB },
    { holder: "research-node-c", value: shareC }
  ];
  const reconstructedScaled = shares.reduce((sum, share) => sum + share.value, 0);
  const reconstructedValue = Number((reconstructedScaled / 10000).toFixed(4));

  return {
    metric,
    sourceValue: value,
    scaledValue,
    shares,
    reconstructedValue,
    verified: reconstructedScaled === scaledValue
  };
}

function buildSecretSharingDemo({ recordId, analysis }) {
  const bandSummary = analysis && analysis.bandSummary ? analysis.bandSummary : {};
  const metrics = Object.entries(bandSummary)
    .filter(([, value]) => Number.isFinite(value))
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([metric, value]) => splitValue(metric, value, recordId));

  return {
    demoType: "Additive Secret Sharing Demo",
    input: "derived_band_summary_only",
    rawEegUsed: false,
    recordId,
    shareCount: 3,
    metrics
  };
}

module.exports = {
  buildSecretSharingDemo
};
