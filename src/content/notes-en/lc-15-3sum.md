---
title: "LeetCode 15. 3Sum"
description: "Sort, fix the first number, and find the other two with opposite-direction two pointers in O(n), skipping equal values to avoid duplicates; O(n²) overall."
translation:
  mode: auto
  sourceHash: "sha256:b20a97cc66c5aa0aabf315f39a877c12caa8abac9dd21a982e32f059a2651ad4"
  generatedHash: "sha256:3b61ea1508bb6929208f42281beeeaf9e4dd9f5965c234e78842690c8bec9462"
  rulesVersion: 1
---

## Problem

Find all triplets in an integer array that sum to 0. The three numbers must come from different positions and their values may be equal, but the answer must not contain duplicate triplets.

## Approach

### Brute force

Three nested for loops enumerate every possible triplet: O(n^3).

### Optimization

Not every combination needs to be checked. Once the array is sorted in ascending order and a is fixed, let b be the number right after a and c the last number in the array. There are 3 cases:

1. a+b+c < 0: the sum needs to grow, so move b right

2. a+b+c > 0: the sum needs to shrink, so move c left

3. a+b+c = 0: record this triplet

This brings the time complexity down to O(n^2)

### Pruning

After fixing a, check two extreme combinations to decide whether this round needs the two-pointer scan at all:

1. a plus the two numbers right after it (the smallest sum this round can make) is already greater than 0: every later a is only larger, so end the whole loop.

2. a plus the last two numbers of the array (the largest sum this round can make) is still less than 0: this a cannot reach 0, so move on to the next a.

Pruning does not change the worst-case time complexity, but it skips many rounds that cannot contain an answer.

## Code

```python
class Solution:
    def threeSum(self, nums: list[int]) -> list[list[int]]:
        n = len(nums)
        ret = []
        nums.sort()

        i_a = 0
        while i_a < n-2:
            # Pruning 1: even this round's smallest sum is greater than 0, and later a values are only larger
            if nums[i_a] + nums[i_a+1] + nums[i_a+2] > 0:
                break
            # Pruning 2: this round's largest sum is still less than 0, so move on to the next a
            if nums[i_a] + nums[n-2] + nums[n-1] < 0:
                i_a += 1
                continue
            i_b = i_a + 1
            i_c = n - 1
            while i_b < i_c:
                if nums[i_a] + nums[i_b] + nums[i_c] < 0:
                    cur_b = nums[i_b]
                    while i_b < i_c and nums[i_b] == cur_b:
                        i_b += 1
                elif nums[i_a] + nums[i_b] + nums[i_c] > 0:
                    cur_c = nums[i_c]
                    while i_b < i_c and nums[i_c] == cur_c:
                        i_c -= 1
                else:
                    ret.append([nums[i_a], nums[i_b], nums[i_c]])
                    cur_b = nums[i_b]
                    while i_b < i_c and nums[i_b] == cur_b:
                        i_b += 1
                    cur_c = nums[i_c]
                    while i_b < i_c and nums[i_c] == cur_c:
                        i_c -= 1
            cur_a = nums[i_a]
            while i_a < n and nums[i_a] == cur_a:
                i_a += 1

        return ret
```

## Complexity

- Time: sorting O(n log n) + outer loop over i_a O(n) × inner two pointers O(n) = O(n²)
- Space: sorting; Python's sort is Timsort, which needs O(n) auxiliary space in the worst case (not counting the answer list)

## Pitfalls

Deduplication: triplets made of exactly the same numbers count as one triplet, so whenever a, b or c moves, it must jump to the next different value.

When the triplet sums to zero, after recording the answer both b and c must skip past values equal to their own; otherwise duplicate answers are recorded.

## Takeaway

When you see "find a few numbers in an array whose sum satisfies some condition":

Sort first, fix the outer numbers, and hand the last two numbers to opposite-direction two pointers.

Which pointer to move depends on whether the current number can still be part of an answer.

When the answer must not contain duplicates, skip equal values at every level.
