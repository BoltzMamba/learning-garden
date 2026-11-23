---
title: "LeetCode 912. Sort an Array"
description: "Quicksort with a random pivot (hole-filling partition): one partition pass splits the array into a ≤-pivot part and a ≥-pivot part, then each part is sorted recursively; expected O(n log n)."
translation:
  mode: auto
  sourceHash: "sha256:0e72fa952da036f72dd5c6377a30b3674f9975995d7ee849762cb63a6f611863"
  generatedHash: "sha256:9e77e1ac051f695dbeb63b29ec30107231b8588b121c49bd98695cf698e6634b"
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

### Why the average is O(n log n) and the worst case is O(n²)

Draw the recursion as a tree: the root is the whole array, and each partition produces a left and a right subarray as its children.

**Each level does O(n) work in total.** In one partition, every number in the range is compared with the pivot once and moved at most once, so the cost is proportional to the range length. The subarrays on one level do not overlap and their lengths add up to at most n, so however the splits fall, each level costs O(n) in total. Therefore:

$$
\text{total time} = O(n) \text{ per level} \times \text{number of levels}
$$

The time complexity depends entirely on how deep the recursion tree is.

**Best case: every split is exactly in half.** Level 0 has 1 array of length n, level 1 has 2 of length n/2, level 2 has 4 of length n/4, and so on; at level k the subarrays have length $n/2^k$. Recursion stops when the length reaches 1, and $n/2^k = 1$ gives $k = \log_2 n$. That is log n levels of n each, O(n log n) in total.

**The splits do not have to be exactly in half.** Even if every split is as lopsided as 1:9, the larger side still shrinks to 9/10 of its length at each level, so reaching length 1 takes $\log_{10/9} n$ levels. Changing the base gives $\log_{10/9} n = \log_2 n / \log_2(10/9) \approx 6.6 \log_2 n$, which is still O(log n) levels, just with a larger constant. So as long as the split ratio does not keep getting more lopsided, the depth is O(log n) and the total time is O(n log n).

**Why a random pivot guarantees this on average.** Divide the range into four quarters by rank. The probability that the pivot's rank falls in the middle two quarters (between the 25th and 75th percentile) is 1/2. Call such a split a "good split": neither side is larger than 3/4 of the original.

Follow any single number x. Each good split that x goes through shrinks the subarray containing it to at most 3/4, so after $\log_{4/3} n$ good splits only x is left. Each partition is a good split with probability 1/2, which is like flipping a coin until it lands heads: on average it takes 2 flips. So x is drawn into only about $2\log_{4/3} n$ partitions on average, that is O(log n). Each number is processed O(log n) times on average, so the n numbers together give expected O(n log n). A more precise calculation gives an expected number of comparisons of about $2n\ln n \approx 1.39\, n\log_2 n$.

**Worst case: every split is 0 and n−1.** If the pivot is always the smallest (or largest) number in its range, one side of the partition is empty and the other loses only the pivot. The recursion tree degenerates into a chain of n levels with lengths n, n−1, n−2, …, 1:

$$
n + (n-1) + \cdots + 1 = \frac{n(n+1)}{2} = O(n^2)
$$

With the leftmost number as a fixed pivot, a sorted array hits this case at every step; with the equals sign in the comparisons, an array of all-equal numbers does too (see the pitfalls below). With a random pivot, hitting the minimum or maximum many times in a row is extremely unlikely, so the worst case almost never happens in practice.

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

## Related problems

### [LeetCode 215. Kth Largest Element in an Array](https://leetcode.cn/problems/kth-largest-element-in-an-array/) (medium, real written-test problem)

<details>
<summary>Approach and code (click to expand)</summary>

It uses the same partition as this problem: the kth largest number is the number at index n−k once the array is sorted in ascending order. After one partition the pivot lands at index m:

- if m equals n−k, the pivot is the answer;
- if m is less than n−k, the answer is on the right, so only the right part is processed;
- if m is greater than n−k, the answer is on the left, so only the left part is processed.

Each step goes into only one side instead of recursing into both; this is quickselect. Expected time is O(n) (n + n/2 + n/4 + … ≈ 2n), worst case O(n²); the extra space is the recursion stack, and since each step recurses into only one side its expected depth is O(log n), worst case O(n). The random pivot and the comparisons without the equals sign are just as necessary here, since this problem's tests also contain a large number of duplicate values.

```python
import random

class Solution:
    def findKthLargest(self, nums: List[int], k: int) -> int:
        n = len(nums)
        def quickselect(left, right):
            l = left
            r = right
            if l >= r:
                return

            p = random.randint(left, right)
            nums[p], nums[l] = nums[l], nums[p]

            base = nums[l]
            blank = l

            while l < r:
                if blank == l:
                    if nums[r] > base:
                        r -= 1
                    else:
                        nums[l] = nums[r]
                        blank = r
                        l += 1
                else:
                    if nums[l] < base:
                        l += 1
                    else:
                        nums[r] = nums[l]
                        blank = l
                        r -= 1
            nums[l] = base
            if l < n - k:
                quickselect(l+1,right)
            elif l > n - k:
                quickselect(left,l-1)
            else:
                return
        quickselect(0, n - 1)

        return nums[n - k]
```

</details>
