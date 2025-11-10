import React, { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import VideoPlayer from "./VideoPlayer";

export default function WatchPage() {
  const { videoId } = useParams(); // <-- รับ videoId จาก URL
  const [videoData, setVideoData] = useState(null);

  useEffect(() => {
    if (!videoId) return;

    fetch(`/api/videos/${videoId}/play`, {
      method: "POST",
      credentials: "include", // สำคัญ ถ้า backend ส่ง cookie
    })
      .then((res) => res.json())
      .then((data) => setVideoData(data))
      .catch(console.error);
  }, [videoId]);

  if (!videoData) return <div>Loading...</div>;

  return (
    <div>
      <h1>Video Player</h1>
      <VideoPlayer
        manifestUrl={videoData.manifestUrl}
        cookies={videoData.cookies}
      />
    </div>
  );
}
