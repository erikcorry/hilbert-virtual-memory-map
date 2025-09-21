# Memory Map Generator

A vibe-coded node utility that takes a list of virtual memory regions and plots them on a
zoomable canvas in your browser.

## Demo

🎮 **[Try the live demo - Chrome Memory Map](https://erikcorry.github.io/hilbert-virtual-memory-map/?file=chrome-maps.txt)** - Features an interactive Chrome browser memory map with smooth zoom animations

🌍 **[Try the live demo - IPv4 GeoIP Visualization](https://erikcorry.github.io/hilbert-virtual-memory-map/?file=geoip2-ipv4.csv)** - Interactive visualization of IPv4 address space with geolocation data

The memory map demo showcases a real Chrome process memory layout captured from `/proc/pid/maps`, demonstrating how memory regions are distributed across the 48-bit virtual address space using a Hilbert curve visualization. The IPv4 demo maps the entire 32-bit IPv4 address space showing geographical distribution of IP allocations.

The Hilbert curve is used to map addresses to pixels, so that any consecutive area is connected in the image.  Resolution is 1 pixel = 64Mbytes.  Tuned to the 47 bit user-space available on Linux.

Understands its own format, but can also read the format of /proc/pid/maps.

For example, use 'top' to find an active Chrome process then start the server:

```
make setup
node index.js /proc/123/maps         # Start on default port 8080
node index.js /proc/123/maps 3000    # Start on port 3000
```

## IPv4 Geolocation Support

The tool also supports IPv4 geolocation databases in CSV format. For example:

```
node index.js geoip2-ipv4.csv        # Start on default port 8080
node index.js geoip2-ipv4.csv 8090   # Start on port 8090
```

The geo IP data used in testing comes from https://github.com/datasets/geoip2-ipv4

![Example Memory Map](example.png)
