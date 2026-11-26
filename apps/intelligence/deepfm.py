"""Optional interaction benchmark trained with the existing validation-only early selection."""
import torch
from torch import nn


class DeepFM(nn.Module):
    def __init__(self, sizes, width=8):
        super().__init__()
        self.embedding = nn.ModuleList(nn.Embedding(n+1, width) for n in sizes)
        self.linear = nn.ModuleList(nn.Embedding(n+1, 1) for n in sizes)
        self.deep = nn.Sequential(nn.Linear(len(sizes)*width,32), nn.ReLU(), nn.Linear(32,1))

    def forward(self, ids):
        factors = torch.stack([layer(ids[:,i]) for i,layer in enumerate(self.embedding)], dim=1)
        fm = 0.5*(factors.sum(dim=1).square()-factors.square().sum(dim=1)).sum(dim=1)
        first = sum(layer(ids[:,i]).squeeze(-1) for i,layer in enumerate(self.linear))
        return first + fm + self.deep(factors.flatten(1)).squeeze(-1)
