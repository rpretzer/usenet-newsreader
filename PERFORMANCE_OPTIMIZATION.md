# Performance Optimization Guide

## Current Performance Issues

The deployed version is slower than local because:

1. **Sequential Article Loading** - Articles are loaded one-by-one (20+ round trips)
2. **No Response Compression** - Large JSON responses aren't compressed
3. **No Caching** - Groups and articles fetched fresh every time
4. **Network Latency** - Browser → GitHub Pages → Railway → NNTP (multiple hops)
5. **Inefficient Header Fetching** - Using individual HEAD commands instead of XOVER

## Performance Improvements

### 1. Use XOVER Command (Biggest Impact)

**Current**: Loading 20 articles = 20 sequential HEAD commands (~2-4 seconds)
**Optimized**: Single XOVER command (~200-400ms)

**Impact**: 10x faster article loading

### 2. Enable Response Compression

**Current**: Full JSON responses sent uncompressed
**Optimized**: Gzip compression reduces data by 70-80%

**Impact**: 3-4x faster data transfer

### 3. Add Response Caching

**Current**: Groups list fetched every time
**Optimized**: Cache groups list for 5 minutes

**Impact**: Instant group loading on repeat visits

### 4. Parallel Article Loading

**Current**: Articles loaded sequentially
**Optimized**: Load multiple articles in parallel (with limits)

**Impact**: 2-3x faster when loading multiple articles

### 5. Connection Pooling

**Current**: Connection checked/recreated on each request
**Optimized**: Better connection reuse and health checks

**Impact**: Eliminates connection overhead

## Implementation Priority

1. **XOVER support** - Biggest performance gain
2. **Response compression** - Easy win, significant impact
3. **Caching** - Good for repeat visits
4. **Parallel loading** - Moderate improvement
5. **Connection optimization** - Small but consistent improvement

## Expected Performance Improvements

- **Article list loading**: 2-4 seconds → 200-400ms (10x faster)
- **Group list loading**: 1-2 seconds → 50-100ms (cached) or 200-300ms (first load)
- **Data transfer**: 70-80% reduction in bandwidth
- **Overall perceived speed**: 3-5x faster

## Network Latency Considerations

Even with optimizations, there's inherent latency:
- Local: Browser → localhost (0-5ms)
- Deployed: Browser → GitHub Pages → Railway → NNTP (100-300ms+ per hop)

This is unavoidable but optimizations minimize the impact.

