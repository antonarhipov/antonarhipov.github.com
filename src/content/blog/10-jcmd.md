---
title: "jcmd - the Swiss Army knife your JVM has been hiding from you"
description: "jcmd - the Swiss Army knife for diagnosing, profiling, and interrogating running Java applications"
date: 2025-02-22
tags: ["debugging", "tracing", "productivity", "troubleshooting"]
draft: true
---

It's 3 AM. Your production app is eating 12 GB of heap and climbing. The on-call Slack channel is lighting up. You SSH into the box, and you need answers — fast. You could reach for `jmap`, `jstat`, `jinfo`, `jstack`... or you could use the **one tool** that replaces all of them.

Meet `jcmd`. It ships with every JDK, it's already on your server, and it's the single most useful command-line tool for talking to a running JVM. Think of it as opening a diagnostic shell directly into the guts of your Java process — no restarts, no agents, no configuration. Just answers.

## Why jcmd exists (and why the old tools are showing their age)

Back in the day, the JDK shipped a small army of diagnostic tools:

| Tool      | What it does                              | Status       |
|-----------|-------------------------------------------|--------------|
| `jps`     | Lists Java processes                      | Superseded   |
| `jstack`  | Prints thread dumps                       | Superseded   |
| `jmap`    | Memory maps and heap dumps                | Superseded   |
| `jinfo`   | JVM flags and system properties           | Superseded   |
| `jstat`   | GC and class loading statistics           | Still useful |

Each one did one thing. Each one had its own flags, its own quirks, its own man page you'd forget by next Tuesday. `jcmd` arrived in JDK 7 and said: *"What if there was just one command, and it could do everything?"*

And it can. Thread dumps, heap dumps, GC stats, JVM flags, class histograms, Flight Recorder sessions, compiler stats, native memory tracking, even dynamically changing JVM flags at runtime. One tool. One interface. Zero ceremony.

## Getting started: who's running?

Before you can talk to a JVM, you need to find it. Run `jcmd` with no arguments:

```bash
$ jcmd
12345 com.mycompany.OrderService
12501 org.apache.kafka.connect.cli.ConnectStandalone
12802 sun.tools.jcmd.JCmd
```

That last one is `jcmd` itself — yes, it's a Java process too. The irony is not lost on anyone.

Each line shows a PID and the main class. If your process was launched with `-jar`, you'll see the JAR path instead. Now you have your target. Let's interrogate it.

## "What can you tell me?" — discovering available commands

Every JVM exposes a different set of diagnostic commands depending on its version and configuration. To see what's available:

```bash
$ jcmd 12345 help
12345:
The following commands are available:
Compiler.codecache
Compiler.codelist
Compiler.directives_print
GC.class_histogram
GC.finalizer_info
GC.heap_dump
GC.heap_info
GC.run
JFR.check
JFR.configure
JFR.dump
JFR.start
JFR.stop
Thread.print
VM.classloader_stats
VM.command_line
VM.dynlibs
VM.flags
VM.info
VM.log
VM.metaspace
VM.native_memory
VM.print_touched_methods
VM.stringtable
VM.symboltable
VM.system_properties
VM.systemdictionary
VM.uptime
VM.version
help
```

That's a lot of power. Let's go through the commands that will save your neck the most often.

## Thread dumps: finding the deadlock at 3 AM

Your app has stopped responding. Requests are piling up. Health checks are timing out. The first thing you need is a **thread dump** — a snapshot of what every thread is doing right now.

```bash
$ jcmd 12345 Thread.print
```

And you get something like:

```
"http-nio-8080-exec-42" #142 daemon prio=5 os_prio=0 tid=0x00007f8b2c01f000 nid=0x1a03 waiting for monitor entry [0x00007f8b0c5fc000]
   java.lang.Thread.State: BLOCKED (on object monitor)
    at com.mycompany.inventory.StockService.updateStock(StockService.java:87)
    - waiting to lock <0x00000006c7a8e1f0> (a com.mycompany.inventory.StockLock)
    - locked <0x00000006c7a8e2b0> (a com.mycompany.order.OrderLock)

"http-nio-8080-exec-17" #117 daemon prio=5 os_prio=0 tid=0x00007f8b2c020800 nid=0x19ef waiting for monitor entry [0x00007f8b0d2fd000]
   java.lang.Thread.State: BLOCKED (on object monitor)
    at com.mycompany.order.OrderService.processOrder(OrderService.java:134)
    - waiting to lock <0x00000006c7a8e2b0> (a com.mycompany.order.OrderLock)
    - locked <0x00000006c7a8e1f0> (a com.mycompany.inventory.StockLock)
```

There it is. A classic **deadlock**. Thread 42 holds `OrderLock` and wants `StockLock`. Thread 17 holds `StockLock` and wants `OrderLock`. They'll wait for each other until the heat death of the universe (or until someone kills the process, which usually comes first).

**Pro tip**: If you're not sure it's a deadlock, the JVM will tell you explicitly. Scroll to the bottom of the thread dump output:

```
Found one Java-level deadlock:
=============================
"http-nio-8080-exec-42":
  waiting to lock monitor 0x00007f8b1c003b58 (object 0x00000006c7a8e1f0, a com.mycompany.inventory.StockLock),
  which is held by "http-nio-8080-exec-17"
"http-nio-8080-exec-17":
  waiting to lock monitor 0x00007f8b1c003a18 (object 0x00000006c7a8e2b0, a com.mycompany.order.OrderLock),
  which is held by "http-nio-8080-exec-42"
```

The JVM literally draws you a diagram. Take multiple thread dumps 5–10 seconds apart and compare them. If the same threads are stuck in the same place across all dumps, you've found your problem.

### Thread dump trick: spotting thread pool exhaustion

Deadlocks are dramatic, but thread pool exhaustion is the more common killer. Here's what it looks like:

```
"http-nio-8080-exec-1" ... TIMED_WAITING (parking)
    at java.base/jdk.internal.misc.Unsafe.park(Native Method)
    at java.base/java.util.concurrent.locks.LockSupport.parkNanos(LockSupport.java:252)
    at java.base/java.util.concurrent.FutureTask.awaitDone(FutureTask.java:432)
    ...
    at com.mycompany.payment.PaymentGateway.charge(PaymentGateway.java:56)

"http-nio-8080-exec-2" ... TIMED_WAITING (parking)
    at java.base/jdk.internal.misc.Unsafe.park(Native Method)
    ...
    at com.mycompany.payment.PaymentGateway.charge(PaymentGateway.java:56)

... (200 more threads, all stuck in PaymentGateway.charge)
```

All 200 threads in your Tomcat pool are waiting on a synchronous call to a payment gateway that's having a bad day. No threads left to serve health checks. The load balancer marks you dead. Cascading failure.

The fix is usually circuit breakers, timeouts, or async calls — but the thread dump is what gets you from "something is broken" to "I know exactly what's broken" in under 10 seconds.

## Heap histograms: who's eating all the memory?

Your monitoring dashboard shows heap usage creeping up. GC pauses are getting longer. Something is leaking. You need to know **what objects** are piling up, and you need to know *right now*, without taking a full heap dump (which can pause the app for seconds or even minutes).

Enter the heap histogram:

```bash
$ jcmd 12345 GC.class_histogram | head -20
```

Output:

```
 num     #instances         #bytes  class name (module)
-------------------------------------------------------
   1:       8234567      395686416  [B (java.base)
   2:       7891234      189389616  java.lang.String (java.base)
   3:       4567890      146172480  java.util.HashMap$Node (java.base)
   4:       2345678       93827120  com.mycompany.cache.SessionData
   5:       2345670       75061440  java.util.LinkedList$Node (java.base)
   6:        987654       47407392  com.mycompany.model.AuditLogEntry
   7:        567890       27258720  java.util.HashMap (java.base)
```

Now *that* tells a story. 2.3 million `SessionData` objects? Your session cache isn't expiring entries. And those `AuditLogEntry` objects — someone is logging every API call into an in-memory list that never gets flushed.

**The `[B` mystery**: `[B` means `byte[]`. `[C` means `char[]`. `[I` means `int[]`. These are JVM internal type signatures. If `[B` is at the top, it usually means strings (since Java 9, strings are backed by byte arrays) or serialized data piling up.

### Comparing histograms over time

The real power move is taking two histograms a few minutes apart and diffing them:

```bash
$ jcmd 12345 GC.class_histogram > /tmp/histo1.txt
# wait 5 minutes
$ jcmd 12345 GC.class_histogram > /tmp/histo2.txt
$ diff /tmp/histo1.txt /tmp/histo2.txt
```

If `com.mycompany.cache.SessionData` went from 2.3 million to 2.8 million instances in 5 minutes with no corresponding traffic increase — congratulations, you've found your leak. Now go look at whatever creates those objects and find out why they're never released.

## Heap dumps: the full autopsy

When a histogram isn't enough, you need the whole picture. A heap dump captures every object on the heap, with references:

```bash
$ jcmd 12345 GC.heap_dump /tmp/heapdump.hprof
```

This creates an HPROF file you can open in tools like **Eclipse MAT**, **VisualVM**, or **IntelliJ IDEA's profiler**. The file can be large — often as big as your heap — so make sure you have disk space.

A few caveats:

- **This will pause your application**. The JVM needs to stop the world to get a consistent snapshot. On a large heap, this can take seconds.
- **In production, think carefully** before triggering this. If you're already under memory pressure, writing a multi-GB file might be the straw that breaks the camel's back.
- **Use `-all` to include unreachable objects**: `jcmd 12345 GC.heap_dump -all /tmp/heapdump.hprof`. Without this flag, a GC runs first and cleans up dead objects. Sometimes those "dead" objects are exactly what you're looking for.

### The "almost out of memory" trick

If your app is about to OOM and you want to capture the state right before it dies, add this to your JVM startup flags:

```bash
-XX:+HeapDumpOnOutOfMemoryError -XX:HeapDumpPath=/var/log/app/
```

This tells the JVM to automatically dump the heap when an `OutOfMemoryError` is thrown. You'll get the crime scene preserved exactly as it was at the moment of death. Forensic gold.

## GC info: understanding the garbage collector's mood

The garbage collector is arguably the most important subsystem in the JVM, and `jcmd` gives you several ways to peek into its state.

### Quick heap overview

```bash
$ jcmd 12345 GC.heap_info
```

Output varies by GC algorithm. With G1 (the default since JDK 9):

```
 garbage-first heap   total 4194304K, used 3145728K [0x0000000700000000, 0x0000000800000000)
  region size 2048K, 800 young (1638400K), 24 survivors (49152K)
 Metaspace       used 125432K, committed 126976K, reserved 1175552K
  class space    used 15678K, committed 16384K, reserved 1048576K
```

Translation: your heap is 4 GB, you're using 3 GB (75%), and you have 800 young generation regions. If that "used" number is consistently above 90% and climbing, you're in trouble.

### Forcing a GC (use wisely)

```bash
$ jcmd 12345 GC.run
```

This triggers a full GC. In production, this is usually a bad idea — a full GC can cause a significant pause. But in a diagnostic session, it's useful: if the heap stays high after a forced GC, the memory is genuinely in use (not garbage). If it drops dramatically, your app is just allocating fast and the GC hasn't had a chance to clean up yet.

### GC tuning secrets hiding in VM.flags

```bash
$ jcmd 12345 VM.flags | tr ' ' '\n' | grep -i gc
```

This shows you exactly which GC flags are active, including defaults you might not know about:

```
-XX:+UseG1GC
-XX:MaxGCPauseMillis=200
-XX:G1HeapRegionSize=2097152
-XX:G1ReservePercent=10
-XX:InitiatingHeapOccupancyPercent=45
-XX:+G1UseAdaptiveIHOP
```

Now you know: G1 is targeting 200ms pause times and will start concurrent marking when the heap hits 45% occupancy. If your pauses are longer than 200ms, the GC is failing to meet its target — time to tune or increase heap.

## VM.info: the "tell me everything" command

If you could run only one `jcmd` command, this would be it:

```bash
$ jcmd 12345 VM.info
```

This prints a comprehensive summary of the entire JVM state. It's pages of output, but it includes:

- **JVM version and build info** (exact build, vendor, runtime version)
- **Heap configuration and usage** (young gen, old gen, metaspace)
- **GC configuration** (which collector, all tuning flags)
- **Thread summary** (count by type, peak, daemon vs. non-daemon)
- **Class loading stats** (loaded, unloaded, shared)
- **Compiler stats** (compiled methods, OSR compilations, failed compilations)
- **Memory breakdown** (heap, metaspace, code cache, thread stacks)
- **CPU and timing info** (uptime, user/system CPU time)
- **Dynamic libraries** (every `.so`/`.dylib` loaded into the process)
- **Environment variables** and **VM arguments**

It's like running `jinfo`, `jstat`, `jmap -heap`, and `jstack` all at once, plus a bunch of things none of those tools could tell you. Pipe it to a file and read it with coffee:

```bash
$ jcmd 12345 VM.info > /tmp/vm_report.txt
```

## VM.flags: the JVM's actual configuration

You think you know how your JVM is configured? You probably don't. Between default values, ergonomic adjustments, and flags set by frameworks, the actual running configuration can be surprising:

```bash
$ jcmd 12345 VM.flags
```

Output:

```
-XX:CICompilerCount=4
-XX:ConcGCThreads=2
-XX:G1ConcRefinementThreads=8
-XX:G1EagerReclaimRemSetThreshold=16
-XX:G1HeapRegionSize=2097152
-XX:GCDrainStackTargetSize=64
-XX:InitialHeapSize=268435456
-XX:MaxHeapSize=4294967296
-XX:MaxNewSize=2576351232
-XX:MinHeapDeltaBytes=2097152
-XX:MinHeapSize=8388608
-XX:NonNMethodCodeHeapSize=5839372
-XX:NonProfiledCodeHeapSize=122909434
-XX:ProfiledCodeHeapSize=122909434
-XX:ReservedCodeCacheSize=251658240
-XX:+SegmentedCodeCache
-XX:SoftMaxHeapSize=4294967296
-XX:+UseCompressedOops
-XX:+UseG1GC
```

Did you know your initial heap was 256 MB but the max was 4 GB? That the JIT compiler has 4 threads? That the code cache is 240 MB? These are defaults the JVM picked based on your machine — and if you haven't tuned them, they might not be right for your workload.

### Dynamically changing flags at runtime

Some flags can be changed on a running JVM without restarting. For example, to enable GC logging:

```bash
$ jcmd 12345 VM.set_flag PrintGCDetails true
```

Or to change the log level:

```bash
$ jcmd 12345 VM.log what=gc*=debug
```

This is incredibly powerful for debugging in production — you can turn up logging, observe, and turn it back off without touching the process.

## VM.system_properties: finding that one rogue property

```bash
$ jcmd 12345 VM.system_properties
```

This dumps every system property in the JVM. Useful for answering questions like:

- *"What file encoding is this JVM using?"* → `file.encoding=UTF-8`
- *"Where is it loading config from?"* → `spring.config.location=/etc/myapp/config/`
- *"Is it using the right temp directory?"* → `java.io.tmpdir=/var/tmp/myapp`
- *"Which Java version is actually running?"* → `java.version=21.0.1`

When your app is behaving differently in production than on your laptop, this command often reveals why. That property you set in your launch script? It was overridden by the container orchestrator. That encoding you assumed? The base image uses something else.

## Java Flight Recorder: profiling without the guilt

`jcmd` is the primary interface for controlling **Java Flight Recorder** (JFR) — the low-overhead, production-safe profiler built into the JVM since JDK 11 (and available in JDK 8u262+).

### Starting a recording

```bash
$ jcmd 12345 JFR.start name=diagnosis duration=60s filename=/tmp/recording.jfr settings=profile
```

This starts a 60-second recording with the "profile" settings (more detail, slightly higher overhead). The `default` settings are for always-on production monitoring; `profile` is for active investigations.

### Checking running recordings

```bash
$ jcmd 12345 JFR.check
```

Output:

```
Recording 1: name=diagnosis duration=60s (running)
Recording 2: name=continuous maxage=12h maxsize=500m (running)
```

### Dumping a continuous recording

If you have a continuous recording running (which you should in production), you can dump the last N minutes at any time:

```bash
$ jcmd 12345 JFR.dump name=continuous filename=/tmp/last_10_minutes.jfr
```

Then open it in **JDK Mission Control** or **IntelliJ IDEA's profiler** to see CPU profiles, allocation flamegraphs, lock contention, I/O activity, and more.

### The "golden recording" setup

Add this to your JVM startup for always-on flight recording with negligible overhead:

```bash
-XX:StartFlightRecording=name=continuous,maxage=12h,maxsize=500m,dumponexit=true,filename=/var/log/app/flight.jfr,settings=default
```

This keeps a rolling 12-hour window of events. When something goes wrong, you just dump it — the evidence is already there. It's like a black box on an airplane, but for your JVM.

## Native memory tracking: when the heap isn't the problem

Here's a scenario that haunts Java developers: your container is getting OOM-killed by Kubernetes, but the heap is only at 60%. Where's the rest of the memory going?

The answer is **native memory** — thread stacks, JIT compiled code, class metadata, direct byte buffers, and native libraries. `jcmd` can track all of it, but you need to enable it at startup:

```bash
java -XX:NativeMemoryTracking=summary -jar myapp.jar
```

Then check the breakdown:

```bash
$ jcmd 12345 VM.native_memory summary
```

Output:

```
Native Memory Tracking:

Total: reserved=6789120KB, committed=4567890KB

-                 Java Heap (reserved=4194304KB, committed=4194304KB)
                            (mmap: reserved=4194304KB, committed=4194304KB)

-                     Class (reserved=1048832KB, committed=126976KB)
                            (classes #21543)
                            (  instance classes #20412, array classes #1131)
                            (mmap: reserved=1048832KB, committed=126976KB)

-                    Thread (reserved=567890KB, committed=567890KB)
                            (thread #553)
                            (stack: reserved=565248KB, committed=565248KB)

-                      Code (reserved=251234KB, committed=98765KB)
                            (mmap: reserved=251234KB, committed=98765KB)

-                        GC (reserved=345678KB, committed=234567KB)

-                  Internal (reserved=12345KB, committed=12345KB)

-                    Symbol (reserved=23456KB, committed=23456KB)

-    Native Memory Tracking (reserved=6789KB, committed=6789KB)

-        Shared class space (reserved=12288KB, committed=12288KB)

-               Arena Chunk (reserved=1234KB, committed=1234KB)

-                   Logging (reserved=5KB, committed=5KB)

-                 Arguments (reserved=2KB, committed=2KB)

-                    Module (reserved=567KB, committed=567KB)

-                 Safepoint (reserved=8KB, committed=8KB)

-           Synchronization (reserved=1234KB, committed=1234KB)
```

**553 threads!** At ~1MB stack per thread, that's 553 MB of committed memory just for thread stacks — not counted in the heap. Add the heap (4 GB), metaspace (124 MB), code cache (96 MB), GC structures (229 MB), and you're way past that 5 GB container limit.

### Tracking memory growth over time

You can set a baseline and then compare:

```bash
$ jcmd 12345 VM.native_memory baseline
Baseline succeeded

# ... wait a while ...

$ jcmd 12345 VM.native_memory summary.diff
```

The diff output shows you exactly what grew:

```
Total: reserved=6890120KB +101000KB, committed=4667890KB +100000KB

-                    Thread (reserved=667890KB +100000KB, committed=667890KB +100000KB)
                            (thread #651 +98)
```

98 new threads appeared and committed 100 MB of stack memory. Someone's creating thread pools without bounds. Again.

## The compiler: what's getting JIT-compiled?

The JIT compiler is one of the JVM's superpowers, but it's also a black box by default. `jcmd` lets you peek inside:

```bash
$ jcmd 12345 Compiler.codecache
```

Output:

```
CodeCache: size=245760Kb used=98765Kb max_used=123456Kb free=146995Kb
 bounds [0x00007f4e78000000, 0x00007f4e82000000, 0x00007f4e87000000]
 total_blobs=24567 nmethods=22345 adapters=1678
 compilation: enabled
              stopped_count=0, restarted_count=0
 full_count=0
```

If `free` is very low or `full_count` is non-zero, the code cache is full. The JIT compiler stops compiling, and performance degrades. Increase it with `-XX:ReservedCodeCacheSize=512m`.

### Which methods have been compiled?

```bash
$ jcmd 12345 Compiler.codelist | head -30
```

This gives you a list of compiled methods. If a performance-critical method isn't compiled, or if it was compiled and then deoptimized, you've found a potential performance issue.

## VM.classloader_stats: the classloader jungle

Classloader leaks are the stuff of nightmares in application servers and OSGi environments. `jcmd` gives you visibility:

```bash
$ jcmd 12345 VM.classloader_stats
```

This shows you every classloader, how many classes it loaded, and how much metaspace it's using. If you see dozens of classloaders each with thousands of classes, and the count keeps growing — you've got a classloader leak, typically from hot-deploying applications that don't clean up properly.

## VM.metaspace: where class definitions live

```bash
$ jcmd 12345 VM.metaspace
```

This gives you a detailed breakdown of metaspace usage. Metaspace replaced PermGen in JDK 8, and while it grows dynamically, it can still cause problems. If you see metaspace growing unboundedly, it's usually a classloader leak or a framework generating proxy classes without limit.

## Practical scenarios: putting it all together

### Scenario 1: "The app is slow but I don't know why"

```bash
# Step 1: Is the GC thrashing?
$ jcmd 12345 GC.heap_info
# If heap is >90% full, the GC is spending all its time collecting

# Step 2: What's filling the heap?
$ jcmd 12345 GC.class_histogram | head -15

# Step 3: Are threads blocked?
$ jcmd 12345 Thread.print | grep -c "BLOCKED"

# Step 4: Get the full picture
$ jcmd 12345 VM.info > /tmp/investigation.txt
```

### Scenario 2: "The container keeps getting OOM-killed"

```bash
# You need native memory tracking enabled at startup:
# java -XX:NativeMemoryTracking=summary -jar myapp.jar

# Step 1: Where is the memory going?
$ jcmd 12345 VM.native_memory summary

# Step 2: Set a baseline
$ jcmd 12345 VM.native_memory baseline

# Step 3: Wait, then check what grew
$ jcmd 12345 VM.native_memory summary.diff

# Common culprits: thread count, direct byte buffers, metaspace
```

### Scenario 3: "It worked yesterday"

```bash
# Step 1: What changed?
$ jcmd 12345 VM.flags         # different JVM flags?
$ jcmd 12345 VM.system_properties  # different config?
$ jcmd 12345 VM.version       # different JVM version?

# Step 2: Compare with a known-good instance
$ jcmd 12345 VM.info > /tmp/broken.txt
$ jcmd 67890 VM.info > /tmp/working.txt
$ diff /tmp/broken.txt /tmp/working.txt
```

## The cheat sheet

Here's a quick reference for the commands you'll use the most:

| Command                        | What it does                              | When to use it                        |
|--------------------------------|-------------------------------------------|---------------------------------------|
| `jcmd`                         | List all Java processes                   | Finding your target PID               |
| `jcmd <pid> help`              | List available commands                   | Discovering what's available          |
| `jcmd <pid> VM.info`           | Full JVM summary                          | First thing in any investigation      |
| `jcmd <pid> Thread.print`      | Thread dump                               | Deadlocks, stuck threads              |
| `jcmd <pid> GC.heap_info`      | Heap overview                             | Memory pressure check                 |
| `jcmd <pid> GC.class_histogram`| Object count by class                     | Memory leaks                          |
| `jcmd <pid> GC.heap_dump <path>` | Full heap dump                          | Deep memory analysis                  |
| `jcmd <pid> VM.flags`          | Active JVM flags                          | Configuration verification            |
| `jcmd <pid> VM.system_properties`| System properties                       | Environment debugging                 |
| `jcmd <pid> VM.native_memory`  | Native memory breakdown                   | Container OOM, off-heap leaks         |
| `jcmd <pid> JFR.start`         | Start Flight Recorder                     | Performance profiling                 |
| `jcmd <pid> JFR.dump`          | Dump recording to file                    | Capturing profiling data              |
| `jcmd <pid> Compiler.codecache`| JIT compiler status                       | Performance degradation               |

## Tips for effective jcmd usage

1. **Use `jcmd <pid> VM.info` first**. Always. It gives you the big picture before you dive into specifics. You'd be surprised how often the problem is obvious from the summary — wrong GC, tiny heap, JDK version mismatch.

2. **Alias the PID lookup**. Typing PIDs is tedious. Use the main class name instead: `jcmd com.mycompany.OrderService Thread.print`. If it's unique, jcmd will resolve it.

3. **Pipe to files, not to your terminal**. Thread dumps and heap histograms can be thousands of lines. Write them to files and search them with `grep`, `less`, or your editor.

4. **Take snapshots, not just one-offs**. A single thread dump tells you what's happening *now*. Three thread dumps 10 seconds apart tell you what's *stuck*. Two heap histograms 5 minutes apart tell you what's *growing*.

5. **Combine with JFR for deep dives**. `jcmd` gives you point-in-time snapshots. JFR gives you continuous recordings. Use `jcmd` to start and control JFR sessions for the best of both worlds.

6. **Enable Native Memory Tracking in staging**. The `-XX:NativeMemoryTracking=summary` flag adds ~5% overhead, which is fine for staging and often acceptable in production. When that container OOM happens, you'll be glad you have it.

7. **Remember permissions**. `jcmd` can only talk to JVMs running as the same user (or as root). If you can't see a process, check who owns it.

## Conclusion

`jcmd` is one of those tools that separates "I think the JVM is doing something weird" from "I know exactly what's happening inside this JVM." It's already installed. It requires no configuration. It introduces no overhead until you use it. And when you need it — at 3 AM, with pages firing, with a VP asking "why is the site down?" — it gives you answers in seconds.

Stop guessing. Start asking the JVM directly. It's been waiting to tell you.
