---
title: "LeetCode 300. Longest Increasing Subsequence"
description: "Defining dp as the best length ending at i gives an O(n²) solution; keeping the smallest tail for each length and binary-searching it brings this down to O(n log n)."
translation:
  mode: auto
  sourceHash: "sha256:f7147940586759944f793d26d010240a531164198c119c2776b00a39cdf107e6"
  generatedHash: "sha256:42840a088d8135bc17cd3ecd05eb031be9cdd1ee5f91c10302ec28144b49b1ec"
  rulesVersion: 1
---

## Problem

Find the length of the longest strictly increasing subsequence of an integer array (the elements need not be contiguous, but their order cannot change).

## Approach

### Solution 1: Dynamic programming

Define dp[i] as the length of the longest increasing subsequence that ends with the i-th number.

Go through the array. For each number r, find the earlier number l that is smaller than it and has the largest dp[l]; then dp[r] = dp[l]+1. If there is no such number, dp[r] defaults to 1.

The longest increasing subsequence does not necessarily end at the last number, so the answer is max(dp), not dp[n−1].

### Solution 2: Greedy + binary search

Use a helper array tails, where tails[k] holds the **smallest** tail value among all increasing subsequences of length k+1.

Why this works:

- **Greedy**: among increasing subsequences of the same length, the smaller the tail, the easier it is to extend with later numbers, so for each length we only need to remember the smallest tail.
- **tails is strictly increasing**: removing the last number from a subsequence of length k+1 gives a subsequence of length k with a smaller tail, so tails[k−1] < tails[k]. Being sorted is what makes binary search possible.

Go through the array. For each number num, find the first position in tails whose value is **≥ num** and replace that value with num; if no value is ≥ num, append num to the end of tails.

The length of tails at the end is the answer. Note that tails itself is usually not a real subsequence: for example, after processing [3, 4, 1], tails is [1, 4], although 1 comes after 4 in the original array. Its length, however, always equals the length of the longest increasing subsequence.

## Code

Solution 1: Dynamic programming

```python
class Solution:
    def lengthOfLIS(self, nums: list[int]) -> int:
        n = len(nums)
        dp = [1] * n
        for r in range(n):
            for l in range(r):
                if nums[r] > nums[l]:
                    new_len = dp[l] + 1
                    dp[r] = max(dp[r],new_len)
        return max(dp)
```

Solution 2: Greedy + binary search

```python
class Solution:
    def lengthOfLIS(self, nums: list[int]) -> int:
        tails = []
        for num in nums:
            l,r = 0,len(tails)
            while l < r:
                mid = (l+r)//2
                if tails[mid] < num:
                    l = mid + 1
                else:
                    r = mid
            if l >= len(tails):
                tails.append(num)
            else:
                tails[l] = num
        return len(tails)
```

## Complexity

- Solution 1: time O(n²), space O(n).
- Solution 2: time O(n log n), one binary search for each of the n numbers; space O(n).

## Pitfalls

1. When I first tried dynamic programming, I defined dp[i] as the length of the longest subsequence among the first i numbers, but that makes it impossible to write a transition: the state does not record which number the subsequence ends with, so you cannot tell whether nums[i] can be appended to it. Defining it as ending with the i-th number fixes the last number, and the transition only needs to compare nums[l] < nums[r].

2. The binary search range is half-open, [l, r), and r starts at len(tails), so the result can equal len(tails), which means num should be appended to the end.

3. When the loop ends, l is the first position with tails[l] ≥ num (equivalent to bisect_left). If the condition is written as tails[mid] <= num, the search finds the first position that is > num (equivalent to bisect_right), so equal numbers get appended and the strictly increasing requirement is broken. For example, [2, 2] would give 2, while the correct answer is 1.

## Summary

- For subsequence problems, first think of a state defined as "ending at i": that fixes the last number, which is what makes the transition possible to write.
- In this problem n ≤ 2500, so O(n²) passes; the follow-up asks for O(n log n), which is Solution 2.
