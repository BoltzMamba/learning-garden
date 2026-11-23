---
title: "LeetCode 912. Sort an Array"
description: "Quicksort with a random pivot (hole-filling partition): one partition pass splits the array into a ≤-pivot part and a ≥-pivot part, then each part is sorted recursively; expected O(n log n)."
translation:
  mode: auto
  sourceHash: "sha256:1d63e5e430bb473165e3e5a7cd47720691c6859094879d2a4872fc4d1d45bb73"
  generatedHash: "sha256:a52e6d714b125f73b5a41ef38f400942f5744c4caebc47a764c0cf20bdccdaab"
  rulesVersion: 1
---

## Problem

Implement a sorting algorithm by hand that sorts the array in ascending order, without using any built-in functions, in O(nlog(n)) time.

## Approach

### Solution

Quicksort. I use the hole-filling method, following the Bilibili video [【三分钟学会快速排序】](https://www.bilibili.com/video/BV1j841197rQ) ("Learn quicksort in three minutes").

In short: pick a random number as the pivot and move it to the leftmost position of the array; that position is then treated as empty (the hole).

Use two pointers: the left pointer starts at the left end and the right pointer at the right end. At the start the left pointer points at the hole, and the right pointer moves left.

If the number at the right pointer is greater than the pivot, the right pointer keeps moving left and the left pointer stays put.

If the number at the right pointer is less than or equal to the pivot, move it into the hole. The right pointer's position becomes the hole, and the left pointer starts moving right.

If the number at the left pointer is less than the pivot, the left pointer keeps moving right and the right pointer stays put.

If the number at the left pointer is greater than or equal to the pivot, move it into the hole. The left pointer's position becomes the hole, and the right pointer starts moving left.

The position where the two pointers meet is exactly where the pivot belongs in the array.

Then handle the left and right subarrays recursively.

## Code

```python
import random

class Solution:
    def sortArray(self, nums: list[int]) -> list[int]:
        n = len(nums)

        def quicksort(left,right):
            l = left
            r = right
            blank = l

            if l >= r:
                return

            p = random.randint(left, right)
            nums[l], nums[p] = nums[p], nums[l]

            base = nums[l]
            while l < r:
                if blank == l: # 固定 l 动 r
                    if nums[r] > base:
                        r -= 1
                    else:
                        nums[l] = nums[r]
                        blank = r
                        l += 1
                elif blank == r:
                    if nums[l] < base:
                        l += 1
                    else:
                        nums[r] = nums[l]
                        blank = l
                        r -= 1
            nums[l] = base
            quicksort(left,l-1)
            quicksort(l+1,right)

        quicksort(0,n-1)
        return nums
```

## Complexity

- Time: expected O(n log n), worst case O(n²). With a random pivot, the worst case is extremely unlikely.
- Space: the sort is in place; the only extra space is the recursion stack, expected O(log n), worst case O(n).

## Pitfalls

1. Choose the pivot at random. Otherwise, when most of the array is already sorted and the leftmost number is always the pivot, a sorted array picks its smallest number as the pivot every time. Each partition leaves 0 numbers on one side and n−1 on the other, so the recursion goes n levels deep and the total time is O(n²).

2. Do not add the equals sign to nums[r] > base and nums[l] < base, or the large number of duplicate values in the tests will blow up the running time.

Example: [2, 2, 2, 2, 2]

- With the equals sign: every 2 the right pointer meets satisfies "≥ pivot", so it keeps moving left until it runs into the left pointer. The pivot stays at the far left and the split is 0 and 4; the next round is the same. Each round removes only one number, n rounds in total, O(n²).

- Without the equals sign: on an equal number the pointer stops and moves it. Equal numbers are moved to the two sides in turn, and the pointers meet in the middle (index 2). The split is 2 and 2, and the recursion is only log n levels deep.

3. When recursing, do not pass in the number that is already in its sorted place (the pivot), or the recursion never ends.

With only the random pivot, or only the comparisons without the equals sign, the solution times out; with both, it does not.

## Review

At an interview with 新凯来 (SiCarrier), I was asked to explain how quicksort works.

This knowledge point also came up in a Shopee written test.

## Summary

The core idea of quicksort is that after partitioning, the numbers on the left are smaller than the pivot and those on the right are larger.

Divide and conquer then turns a large array into smaller arrays and solves the problem recursively with the same method, from small to large.
