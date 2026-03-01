---
title: "Tracing - an underrated technique for making sense of all the mess"
description: "Tracing - an underrated technique for making sense of all the mess in your application"
date: 2025-02-22
tags: ["debugging", "tracing", "productivity", "troubleshooting"]
draft: true
---

You're staring at a codebase you barely know. Thousands of classes, layers of abstractions, frameworks doing magic behind the scenes. You set a breakpoint, hit it, and… now what? You're frozen in time at a single point, trying to reconstruct the flow from a stack trace and a handful of variables. You step through a few lines, lose track of the bigger picture, and start over.

There's a better way to explore unfamiliar code — and it's been hiding in plain sight for decades. It's called **tracing**, and on the JVM it's surprisingly easy to set up.

## What is tracing (and what it is not)

Let me be clear upfront: I'm not talking about distributed tracing with OpenTelemetry, Jaeger, or Zipkin. Those are observability tools for production systems. What I'm talking about is something much more immediate and developer-facing — **instrumenting your application's bytecode at development time to record and visualize how it actually executes**.

Think of it as supercharged logging that you never have to write. Instead of manually adding `log.debug("entering method X")` everywhere, you attach a Java agent that automatically records method entries, exits, arguments, return values, and timings — and then you look at the resulting trace to understand what happened.

It's not a profiler either. A profiler answers "what's slow?" Tracing answers **"what's happening?"** — and more importantly, **"in what order and on which thread?"**

## Why tracing beats the debugger for exploration

The debugger is fantastic when you know *where* to look. You set a breakpoint, inspect state, and reason about behavior at a specific point in time. But exploration is a different game. When you're trying to understand how a request flows through a Spring application, or what happens when a Kafka message is consumed, or how some third-party library initializes itself — the debugger is like trying to understand a movie by pausing it frame by frame.

Tracing gives you the whole movie at once. You see the entire call tree, the thread switches, the async handoffs. You notice patterns: "Oh, this method is called 47 times during startup" or "Wait, why is this being invoked on a completely different thread?"

Here's the key insight: **program execution is not linear, but logging is**. Your logs show you a flat sequence of events, and your brain has to reconstruct the hierarchy, the concurrency, and the causality. With a trace, that structure is preserved and visible.

## The Java agent approach

The JVM has a built-in mechanism for bytecode instrumentation — the `java.lang.instrument` package and the `-javaagent` flag. A Java agent can intercept class loading and rewrite bytecode before it runs, which means you can inject tracing logic into any method of any class without modifying source code.

Here's a minimal agent that traces method entries and exits:

```java
import java.lang.instrument.Instrumentation;
import java.lang.instrument.ClassFileTransformer;
import java.security.ProtectionDomain;

public class TracingAgent {
    public static void premain(String args, Instrumentation inst) {
        inst.addTransformer(new TracingTransformer());
    }
}
```

The `premain` method is called before your application's `main`. You register a `ClassFileTransformer` that gets a chance to modify every class as it's loaded:

```java
public class TracingTransformer implements ClassFileTransformer {
    @Override
    public byte[] transform(ClassLoader loader,
                            String className,
                            Class<?> classBeingRedefined,
                            ProtectionDomain protectionDomain,
                            byte[] classfileBuffer) {
        if (className == null || className.startsWith("java/")
                || className.startsWith("sun/")
                || className.startsWith("jdk/")) {
            return null; // don't instrument JDK classes
        }
        // Use a bytecode library to add tracing
        return instrumentClass(className, classfileBuffer);
    }
}
```

For the actual bytecode manipulation, you'd typically use a library like [ByteBuddy](https://bytebuddy.net/) or ASM. ByteBuddy is particularly pleasant to work with:

```java
import net.bytebuddy.agent.builder.AgentBuilder;
import net.bytebuddy.asm.Advice;
import static net.bytebuddy.matcher.ElementMatchers.*;

public class TracingAgent {
    public static void premain(String args, Instrumentation inst) {
        new AgentBuilder.Default()
            .type(nameStartsWith("com.myapp"))
            .transform((builder, type, classLoader, module, domain) ->
                builder.visit(Advice.to(TracingAdvice.class)
                    .on(isMethod())))
            .installOn(inst);
    }
}
```

And the advice class that gets woven into every method:

```java
public class TracingAdvice {
    @Advice.OnMethodEnter
    static long enter(@Advice.Origin String method) {
        TraceRecorder.enter(Thread.currentThread().getName(), method);
        return System.nanoTime();
    }

    @Advice.OnMethodExit(onThrowable = Throwable.class)
    static void exit(@Advice.Origin String method,
                     @Advice.Enter long startTime,
                     @Advice.Thrown Throwable thrown) {
        long duration = System.nanoTime() - startTime;
        TraceRecorder.exit(Thread.currentThread().getName(),
            method, duration, thrown);
    }
}
```

You run it by packaging the agent as a JAR with the proper manifest and adding it to your JVM startup:

```bash
java -javaagent:tracing-agent.jar -jar myapp.jar
```

That's it. No code changes to your application. No recompilation. You can even attach it to applications you don't have the source code for.

## What a trace reveals

Once you have the trace data, you can render it as a **call tree** or a **flame chart** — but the most illuminating view for exploration is a **timeline view** that shows threads on the Y-axis and time on the X-axis. Each method call becomes a span on the timeline, nested under its caller.

Here's a sketch of what that looks like for an HTTP request in a Spring Boot app:

```
main thread    │▓▓▓ DispatcherServlet.doDispatch ▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓│
               │  ▓ HandlerMapping.getHandler ▓│                       │
               │     ▓ RequestMappingHandler.. ▓│                      │
               │                                ▓ UserController.get ▓▓│
               │                                │ ▓ UserService.find ▓ │
               │                                │ │ ▓ UserRepo.query ▓ │
               │                                                       │
pool-thread-1  │            ▓▓ AuditService.logAsync ▓▓▓▓│            │
               │            │  ▓ AuditRepo.save ▓▓▓▓▓│               │
               │                                                       │
time ──────────┼───────────────────────────────────────────────────────►
```

Suddenly you can *see* things that are invisible in logs or in a debugger:

- **The async handoff**: the audit logging is happening on a different thread, triggered somewhere inside `UserController.get`. You'd never catch that in a linear log without careful correlation.
- **The real cost of the call**: `UserRepo.query` is a thin sliver — the database is fast. But `HandlerMapping.getHandler` is surprisingly wide. Framework overhead? Route matching with too many endpoints?
- **The sequencing**: the audit service starts *before* the response is returned. Is that intentional? What happens if it fails?

## Issues you can find with tracing

Tracing is an exploration tool first, but the things it reveals often point directly to real problems:

### Unexpected thread hopping
You trace a request and discover that your "synchronous" controller method is actually bouncing across three different thread pools because of reactive operators hidden in a library. This thread hopping can cause lost MDC context, broken transaction boundaries, and ClassLoader issues.

### Hidden sequential bottlenecks
Two services that you assumed were called in parallel turn out to be strictly sequential. The trace shows them stacked one after another on the same thread. Nobody intended this — it just happened because someone used `CompletableFuture.get()` immediately after submission.

### N+1 queries (visually obvious)
You see a pattern like this in the trace:

```
▓ findAllOrders ▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓
  ▓ loadCustomer ▓│                                
  │               ▓ loadCustomer ▓│                
  │                               ▓ loadCustomer ▓│
  ...48 more times...
```

In a log, this would be 50 identical-looking SQL statements that your eyes glaze over. In a trace, the visual pattern screams at you.

### Framework overhead you didn't know about
You instrument a simple REST endpoint and discover that Spring executes 23 filter chain methods, 8 interceptors, and 4 argument resolvers before your controller method is even invoked. Is this normal? Probably. But now you *know*, and when something breaks in that pipeline, you know where to look.

### Initialization order surprises
Tracing the startup sequence often reveals unexpected dependency chains: bean A triggers lazy initialization of bean B, which pulls in half the application context. Or worse — circular references that are silently resolved by CGLIB proxies.

### Callback storms
An event-driven system fires an event that triggers a listener that fires another event that triggers three more listeners. The trace shows a cascade of calls that fans out exponentially. Without tracing, you'd need to grep through event handlers and mentally construct the chain.

## Practical tools worth knowing

You don't have to build everything from scratch. Here are some tools that make JVM tracing practical:

- **[ByteBuddy](https://bytebuddy.net/)** — the most developer-friendly bytecode manipulation library for building Java agents. Great documentation and a fluent API.
- **[BTrace](https://github.com/btraceio/btrace)** — a safe, dynamic tracing tool for the JVM. It can attach to running processes and has a scripting language for defining trace points.
- **[async-profiler](https://github.com/async-profiler/async-profiler)** — while primarily a profiler, its wall-clock mode with JFR output captures call traces that are perfect for exploration.
- **[IntelliJ IDEA's built-in tracing](https://www.jetbrains.com/idea/)** — non-suspending breakpoints with logging can give you trace-like output without any agent setup (I covered this in an [earlier post](/blog/06-intellij-debugger-zero-code-tracing)).

## Tracing vs. logging vs. debugging — when to use what

| Technique   | Best for                            | Limitation                                    |
|-------------|-------------------------------------|-----------------------------------------------|
| **Debugging** | Inspecting state at a specific point | Pauses execution; hard to see the big picture |
| **Logging**   | Recording known events of interest   | Linear; requires you to know what to log       |
| **Tracing**   | Understanding execution flow         | Overhead; can produce large amounts of data    |

These aren't competing techniques — they're complementary. Use tracing to get the lay of the land, logging to monitor known important events, and the debugger to deep-dive into a specific issue once you know where it is.

## Tips for effective tracing

1. **Filter aggressively**. Don't trace everything. Start with your application's packages and exclude frameworks until you specifically need to see their internals.
2. **Use short-lived sessions**. Attach the agent, trigger the scenario you want to understand, stop. Don't leave tracing on while you go get coffee.
3. **Trace a single request**. If possible, isolate one request or one operation. Tracing everything in a busy application will give you a haystack, not a needle.
4. **Visualize, don't read**. A trace dumped as text is barely better than logs. Use a tool that renders it as a timeline or call tree.
5. **Compare traces**. Record a trace of the happy path and another of the failing case. Diff them visually — the divergence point is usually the bug.

## Conclusion

Tracing on the JVM is absurdly underused as a development tool. We reach for the debugger out of habit, add logging statements out of desperation, and stare at stack traces hoping for inspiration. Meanwhile, the JVM's instrumentation API is sitting right there, ready to show us exactly what our application is doing — across threads, across async boundaries, across all the layers of abstraction we've built.

It's not a profiler. It's not a performance tool. It's an **exploration tool** — a way to turn the invisible runtime behavior of your application into something you can see, navigate, and reason about. And in a world of increasingly complex, concurrent, event-driven applications, being able to *see* what's happening is half the battle.
