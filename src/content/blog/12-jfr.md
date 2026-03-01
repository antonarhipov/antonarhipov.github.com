---
title: "Java Flight Recorder - the default Java profiler"
description: "How to use Java Flight Recorder (JFR) to profile your Java applications"
date: 2025-02-23
tags: ["debugging", "tracing", "productivity", "troubleshooting"]
draft: true
---

Java Flight Recorder (JFR) is a powerful profiling tool that comes bundled with the Java Development Kit (JDK) since Java 7. It's designed to provide detailed insights into the performance and behavior of Java applications without impacting their runtime performance significantly. JFR is particularly useful for diagnosing issues related to memory leaks, thread contention, and overall application performance.

JFR records events such as method invocations, garbage collection activities, and system events at a high frequency, making it a valuable tool for both development and production environments. Unlike traditional profilers that require manual intervention or instrumentation, JFR operates in a non-intrusive manner, allowing you to collect data without modifying your application code.

In this blog post, we'll explore the basics of JFR, how to enable it, and some of the key features that make it a go-to tool for Java developers.