export const handler = async (event) => {
  for (const record of event.Records) {
    const message = JSON.parse(record.body);

    console.log("MediaConvert:", message);

    const jobId = message.detail?.jobId;
    const status = message.detail?.status;
    const videoId = message.detail?.userMetadata?.VideoId;

    if (!videoId) {
      console.warn("No videoId found");
      continue;
    }

    if (status === "COMPLETE") {
      await markVideoReady(videoId, jobId);
    }

    if (status === "ERROR") {
      await markVideoFailed(videoId, jobId);
    }
  }
};