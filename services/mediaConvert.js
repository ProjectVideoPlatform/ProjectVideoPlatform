const { mediaConvert, config } = require('../config/aws');

// สร้าง MediaConvert Job สำหรับ HLS
const createMediaConvertJob = async (inputS3Path, outputS3Path, videoId) => {
  const jobSettings = {
    Role: config.mediaConvertRole,
    Settings: {
      Inputs: [{
        FileInput: inputS3Path,
        AudioSelectors: {
          "Audio Selector 1": {
            DefaultSelection: "DEFAULT"
          }
        },
        VideoSelector: {},
        TimecodeSource: "ZEROBASED"
      }],
      OutputGroups: [
        // HLS Output Group
        {
          Name: "Apple HLS",
          OutputGroupSettings: {
            Type: "HLS_GROUP_SETTINGS",
            HlsGroupSettings: {
              Destination: outputS3Path,
              SegmentLength: 6,
              MinSegmentLength: 0,
              DirectoryStructure: "SINGLE_DIRECTORY",
              ManifestDurationFormat: "INTEGER",
              StreamInfResolution: "INCLUDE",
              ClientCache: "ENABLED",
              ManifestCompression: "NONE",
              CodecSpecification: "RFC_4281",
              OutputSelection: "MANIFESTS_AND_SEGMENTS",
              TimestampDeltaMilliseconds: 0,
              MinFinalSegmentLength: 0,
              SegmentControl: "SEGMENTED_FILES",
              TimedMetadataId3Frame: "TDRL",
              TimedMetadataId3Period: 10,
              AdMarkers: ["ELEMENTAL"] 
            }
          },
          Outputs: [
            // 1080p output
            {
              VideoDescription: {
                Width: 1920,
                Height: 1080,
                CodecSettings: {
                  Codec: "H_264",
                  H264Settings: {
                    RateControlMode: "QVBR",
                    QualityTuningLevel: "SINGLE_PASS_HQ",
                    QvbrSettings: { QvbrQualityLevel: 8 },
                    MaxBitrate: 5000000,
                    FramerateControl: "INITIALIZE_FROM_SOURCE",
                    GopSizeUnits: "SECONDS",
                    GopSize: 2,
                    NumberBFramesBetweenReferenceFrames: 2,
                    GopClosedCadence: 1,
                    InterlaceMode: "PROGRESSIVE"
                  }
                }
              },
              AudioDescriptions: [{
                CodecSettings: {
                  Codec: "AAC",
                  AacSettings: {
                    Bitrate: 128000,
                    CodingMode: "CODING_MODE_2_0",
                    SampleRate: 48000
                  }
                }
              }],
              ContainerSettings: {
                Container: "M3U8",
                M3u8Settings: {
                      Scte35Source: "PASSTHROUGH" // หรือ "PASSTHROUGH"
                }
              },
              NameModifier: "_1080p"
            },
            // 720p output
            {
              VideoDescription: {
                Width: 1280,
                Height: 720,
                CodecSettings: {
                  Codec: "H_264",
                  H264Settings: {
                    RateControlMode: "QVBR",
                    QualityTuningLevel: "SINGLE_PASS_HQ",
                    QvbrSettings: { QvbrQualityLevel: 7 },
                    MaxBitrate: 3000000,
                    FramerateControl: "INITIALIZE_FROM_SOURCE",
                    GopSizeUnits: "SECONDS",
                    GopSize: 2,
                    NumberBFramesBetweenReferenceFrames: 2,
                    GopClosedCadence: 1,
                    InterlaceMode: "PROGRESSIVE"
                  }
                }
              },
              AudioDescriptions: [{
                CodecSettings: {
                  Codec: "AAC",
                  AacSettings: {
                    Bitrate: 128000,
                    CodingMode: "CODING_MODE_2_0",
                    SampleRate: 48000
                  }
                }
              }],
              ContainerSettings: {
                Container: "M3U8",
                M3u8Settings: {
                      Scte35Source: "PASSTHROUGH" // หรือ "PASSTHROUGH"
                }
              },
              NameModifier: "_720p"
            },
            // 480p output
            {
              VideoDescription: {
                Width: 854,
                Height: 480,
                CodecSettings: {
                  Codec: "H_264",
                  H264Settings: {
                    RateControlMode: "QVBR",
                    QualityTuningLevel: "SINGLE_PASS_HQ",
                    QvbrSettings: { QvbrQualityLevel: 7 },
                    MaxBitrate: 1500000,
                    FramerateControl: "INITIALIZE_FROM_SOURCE",
                    GopSizeUnits: "SECONDS",
                    GopSize: 2,
                    NumberBFramesBetweenReferenceFrames: 2,
                    GopClosedCadence: 1,
                    InterlaceMode: "PROGRESSIVE"
                  }
                }
              },
              AudioDescriptions: [{
                CodecSettings: {
                  Codec: "AAC",
                  AacSettings: {
                    Bitrate: 128000,
                    CodingMode: "CODING_MODE_2_0",
                    SampleRate: 48000
                  }
                }
              }],
              ContainerSettings: {
                Container: "M3U8",
                M3u8Settings: {
                      Scte35Source: "PASSTHROUGH" // หรือ "PASSTHROUGH"
                }
              },
              NameModifier: "_480p"
            }
          ]
        },
        // Thumbnail Output Group
        {
          Name: "Thumbnails",
          OutputGroupSettings: {
            Type: "FILE_GROUP_SETTINGS",
            FileGroupSettings: {
              Destination: `${outputS3Path}thumbnails/`
            }
          },
          Outputs: [{
            VideoDescription: {
              Width: 1280,
              Height: 720,
              CodecSettings: {
                Codec: "FRAME_CAPTURE",
                FrameCaptureSettings: {
                  FramerateNumerator: 1,
                  FramerateDenominator: 60,
                  MaxCaptures: 10,
                  Quality: 80
                }
              }
            },
            ContainerSettings: {
              Container: "RAW"
            },
            Extension: "jpg",
            NameModifier: "_thumb"
          }]
        }
      ]
    },
    UserMetadata: {
      VideoId: videoId
    }
  };

  const params = {
    Queue: 'Default',
    UserMetadata: {
      VideoId: videoId
    },
    Role: config.mediaConvertRole,
    Settings: jobSettings.Settings
  };

  try {
    const result = await mediaConvert.createJob(params).promise();
    console.log(`MediaConvert job created: ${result.Job.Id} for video: ${videoId}`);
    return result.Job;
  } catch (error) {
    console.error('MediaConvert job creation failed:', error);
    throw error;
  }
};

// ตรวจสอบสถานะ MediaConvert Job
const getJobStatus = async (jobId) => {
  try {
    const params = { Id: jobId };
    const result = await mediaConvert.getJob(params).promise();
    return result.Job;
  } catch (error) {
    console.error('Failed to get job status:', error);
    throw error;
  }
};

// Cancel MediaConvert Job
const cancelJob = async (jobId) => {
  try {
    const params = { Id: jobId };
    const result = await mediaConvert.cancelJob(params).promise();
    console.log(`MediaConvert job cancelled: ${jobId}`);
    return result;
  } catch (error) {
    console.error('Failed to cancel job:', error);
    throw error;
  }
};

// List MediaConvert Jobs
const listJobs = async (status = null, maxResults = 20) => {
  try {
    const params = {
      MaxResults: maxResults,
      Order: 'DESCENDING'
    };
    
    if (status) {
      params.Status = status;
    }
    
    const result = await mediaConvert.listJobs(params).promise();
    return result.Jobs;
  } catch (error) {
    console.error('Failed to list jobs:', error);
    throw error;
  }
};

module.exports = {
  createMediaConvertJob,
  getJobStatus,
  cancelJob,
  listJobs
};