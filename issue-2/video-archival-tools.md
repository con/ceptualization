# Video Archival Tools

## Overview

Tools and methods for archiving video content from YouTube, Zoom, and other platforms. Essential for the multimedia archival component of con/flux.

## YouTube Archival

### yt-dlp (Recommended)
- **Type:** Command-line program
- **Repository:** https://github.com/yt-dlp/yt-dlp
- **Status:** Fork of youtube-dl with active development
- **License:** Public domain (unlicense)

#### Key Features
- Download videos and audio from YouTube
- Extract metadata, subtitles, thumbnails
- Format selection (quality, codec)
- Playlist support
- Robust error handling
- Regular updates to handle YouTube changes

#### Capabilities
```bash
# Download video with best quality
yt-dlp https://www.youtube.com/watch?v=VIDEO_ID

# Download only audio
yt-dlp -x --audio-format mp3 URL

# Download entire playlist
yt-dlp https://www.youtube.com/playlist?list=PLAYLIST_ID

# Download with metadata
yt-dlp --write-description --write-info-json --write-thumbnail URL

# Download subtitles
yt-dlp --write-subs --sub-lang en URL
```

#### Integration for con/flux
```python
import yt_dlp

class YouTubeCollector:
    def collect_video(self, video_url):
        ydl_opts = {
            'writeinfojson': True,
            'writesubtitles': True,
            'writethumbnail': True,
            'outtmpl': 'archives/youtube/%(id)s/%(title)s.%(ext)s',
        }

        with yt_dlp.YoutubeDL(ydl_opts) as ydl:
            info = ydl.extract_info(video_url, download=True)
            return info
```

### youtube-dl (Original)
- **Status:** Original project, maintenance mode
- **Note:** yt-dlp is recommended as more actively maintained
- **Repository:** https://github.com/ytdl-org/youtube-dl

### Pytube
- **Type:** Python library
- **Features:**
  - Lightweight, no dependencies
  - Programmatic API
  - Stream selection
- **Status:** Requires monitoring for YouTube API changes
- **Use Case:** When you need a pure Python solution

```python
from pytube import YouTube

yt = YouTube('https://www.youtube.com/watch?v=VIDEO_ID')
stream = yt.streams.get_highest_resolution()
stream.download(output_path='archives/youtube/')
```

### 2026 YouTube Downloader Status

#### Current Challenges
⚠️ **Many tools stopped working** after YouTube backend changes
⚠️ Testing in October 2026 found only 6 out of 15 tools still function
⚠️ Frequent updates needed to keep up with platform changes

#### Working Solutions (2026)
- ✅ **yt-dlp:** Most reliable, actively maintained
- ✅ **4K Video Downloader:** Commercial, desktop app
- ⚠️ **youtube-dl:** Works but slower updates than yt-dlp

#### Recommendations
1. **Primary:** Use yt-dlp (most actively maintained)
2. **Monitor:** Check for updates regularly
3. **Fallback:** Have alternative tools configured
4. **Test:** Validate downloads in CI/CD pipeline

## Zoom Recording Backup

### zoom-recording-downloader
- **Repository:** https://github.com/ricardorodrigues-ca/zoom-recording-downloader
- **Type:** Python script
- **Requirements:** Zoom Business account

#### Features
- Downloads all cloud recordings
- Organizes by meeting/date
- Metadata preservation
- Automatic discovery

#### Usage
```bash
# Configure API credentials
export ZOOM_API_KEY=your_key
export ZOOM_API_SECRET=your_secret

# Run download
python zoom_downloader.py --output-dir archives/zoom/
```

#### Integration for con/flux
```python
class ZoomCollector:
    def __init__(self, api_key, api_secret):
        self.client = ZoomClient(api_key, api_secret)

    def collect_recordings(self, start_date, end_date):
        recordings = self.client.list_recordings(
            from_date=start_date,
            to_date=end_date
        )

        for recording in recordings:
            self.download_recording(recording)
            self.extract_metadata(recording)
            self.commit_to_datalad(recording)
```

### git-annex Integration for Zoom
**Current Setup (from issue):** con/ceptualization already has git-annex orchestration for Zoom recordings

**Approach:**
- Store recordings in git-annex (large files)
- Metadata in git (small files)
- Track with DataLad dataset
- Organize by meeting ID or date

```bash
# Add Zoom recording to git-annex
cd archives/zoom/
git annex add meeting-12345.mp4
git commit -m "Add Zoom recording from 2026-02-05"

# Track with DataLad
datalad save -m "Add Zoom recording"
```

## OBS Studio for Live Recording

### Overview
- **Type:** Free, open-source recording software
- **Use Case:** Record live streams, meetings, presentations
- **Features:**
  - Screen capture
  - Webcam integration
  - Multiple audio sources
  - Real-time mixing

### Applications for con/flux
- Archive live team meetings
- Record conference presentations
- Capture webinars
- Screen recording of demos

## General Video Archival Tools

### Open Video Downloader
- **Type:** Desktop application
- **Platform:** Cross-platform
- **Features:**
  - Support for multiple sites
  - GUI interface
  - Batch downloads

### ffmpeg (Processing)
- **Type:** Command-line multimedia framework
- **Use Case:** Post-processing, conversion, extraction

```bash
# Extract audio from video
ffmpeg -i video.mp4 -vn -acodec mp3 audio.mp3

# Create thumbnail
ffmpeg -i video.mp4 -ss 00:00:01 -vframes 1 thumbnail.jpg

# Compress video
ffmpeg -i input.mp4 -vcodec h264 -acodec aac output.mp4
```

## Metadata Extraction

### youtube-dl/yt-dlp JSON Output
```json
{
  "id": "VIDEO_ID",
  "title": "Video Title",
  "description": "Full description...",
  "uploader": "Channel Name",
  "upload_date": "20260205",
  "duration": 1234,
  "view_count": 10000,
  "like_count": 500,
  "tags": ["tag1", "tag2"],
  "categories": ["Education"],
  "thumbnail": "https://...",
  "subtitles": {
    "en": [{"ext": "vtt", "url": "https://..."}]
  }
}
```

### Integration with con/flux Metadata Schema
```yaml
# archives/youtube/VIDEO_ID/metadata.yaml
source:
  type: youtube
  platform_id: VIDEO_ID
  url: https://youtube.com/watch?v=VIDEO_ID

content:
  title: "Video Title"
  description: "..."
  uploader: "Channel Name"
  upload_date: 2026-02-05
  duration_seconds: 1234

metrics:
  views: 10000
  likes: 500

files:
  video: VIDEO_ID.mp4
  audio: VIDEO_ID.mp3
  thumbnail: VIDEO_ID.jpg
  subtitles:
    - VIDEO_ID.en.vtt
    - VIDEO_ID.es.vtt

collected:
  timestamp: 2026-02-05T14:30:00Z
  collector_version: 1.0.0
```

## con/annextube Integration

**Existing Tool (from issue):** con/annextube for YouTube closed captions and comments

### Capabilities
- Closed caption archival
- Comment thread extraction
- Metadata preservation

### Integration Strategy
1. Use yt-dlp for video/audio download
2. Use con/annextube for captions/comments
3. Store everything in unified DataLad dataset
4. Link metadata between components

```
archives/youtube/VIDEO_ID/
├── video.mp4              # yt-dlp
├── audio.mp3              # yt-dlp
├── thumbnail.jpg          # yt-dlp
├── info.json              # yt-dlp
├── captions/              # con/annextube
│   ├── en.vtt
│   └── es.vtt
├── comments/              # con/annextube
│   └── comments.json
└── metadata.yaml          # Unified metadata
```

## Archival Best Practices

### 1. Format Selection
- **Video:** MP4 (H.264) - widely compatible
- **Audio:** MP3 or AAC - universal support
- **Subtitles:** VTT or SRT - standard formats
- **Metadata:** JSON or YAML - machine readable

### 2. Quality Considerations
- Download best available quality
- Store original format + compressed version
- Keep source resolution metadata
- Preserve audio bitrate information

### 3. Storage Efficiency
```python
# Use git-annex for large video files
git annex add *.mp4 *.avi *.mov

# Keep metadata in git
git add *.json *.yaml *.txt

# Commit both
git commit -m "Archive video and metadata"
```

### 4. Update Strategy
- **Incremental:** Check for new videos daily
- **Full sync:** Weekly verification of existing videos
- **Metadata refresh:** Update view counts, comments monthly
- **Deletion detection:** Track if videos removed

### 5. Error Handling
```python
class VideoCollector:
    def collect_with_retry(self, url, max_retries=3):
        for attempt in range(max_retries):
            try:
                return self.collect_video(url)
            except DownloadError as e:
                if attempt == max_retries - 1:
                    self.log_failure(url, e)
                    return None
                time.sleep(2 ** attempt)  # Exponential backoff
```

## Platform-Specific Considerations

### YouTube
- ✅ yt-dlp is well-maintained
- ✅ Rich metadata available
- ⚠️ API may change without notice
- ⚠️ Rate limiting for large collections

### Zoom
- ✅ Official API available
- ✅ Well-structured metadata
- ⚠️ Requires Business account
- ⚠️ Storage quotas on cloud recordings

### Other Platforms
- **Vimeo:** Supported by yt-dlp
- **Twitch:** Supported by yt-dlp
- **Twitter/X:** Video support via yt-dlp
- **Facebook:** Limited support, check current status

## Recommendations for con/flux

### Video Collection Pipeline
1. **Discovery:** Identify video sources (channels, meetings)
2. **Download:** Use yt-dlp for videos, zoom-downloader for Zoom
3. **Extraction:** Get metadata, subtitles, thumbnails
4. **Storage:** Save in DataLad dataset with git-annex
5. **Indexing:** Create searchable metadata database
6. **Monitoring:** Track collection status, errors

### Configuration Example
```yaml
# config/sources/youtube.yaml
source:
  type: youtube
  channels:
    - UCxxxxxx  # Channel ID 1
    - UCyyyyyy  # Channel ID 2
  playlists:
    - PLzzzzzz  # Playlist ID

options:
  format: best
  subtitles: true
  thumbnail: true
  metadata: true

schedule:
  frequency: daily
  time: "03:00"

storage:
  dataset: archives/youtube
  video_format: mp4
  audio_extract: true
```

## Tools Summary

| Tool | Best For | Status (2026) | License |
|------|----------|---------------|---------|
| **yt-dlp** | YouTube videos | ✅ Active | Public Domain |
| **youtube-dl** | YouTube fallback | ⚠️ Slower updates | Public Domain |
| **Pytube** | Python integration | ⚠️ Needs monitoring | MIT |
| **zoom-recording-downloader** | Zoom recordings | ✅ Active | Open Source |
| **OBS Studio** | Live recording | ✅ Very Active | GPL |
| **ffmpeg** | Post-processing | ✅ Very Active | LGPL/GPL |

## Sources

- [Best Open Source Windows YouTube Downloaders 2026](https://sourceforge.net/directory/youtube-downloaders/)
- [Best YouTube Downloader: 6 Working Tools January 2026](https://screenapp.io/blog/top-youtube-downloaders)
- [GitHub - ricardorodrigues-ca/zoom-recording-downloader](https://github.com/ricardorodrigues-ca/zoom-recording-downloader)
- [Top Zoom Video Downloaders (Free and Paid)](https://tactiq.io/learn/zoom-video-downloader)
- [Open Video Downloader 3.1.1 Download Free](https://www.videohelp.com/software/Open-Video-Downloader)
- [Best Free Youtube Video Downloader Apps January 2026 Update](https://magazine.digitalslrphoto.com/news/best-free-youtube-video-downloader-apps-january-2026-update)
