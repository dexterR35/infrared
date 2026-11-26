import torch
from torch import nn


class DIN(nn.Module):
    """Candidate-conditioned pooling of elements previously observed in this page view."""
    def __init__(self, sizes, width=8):
        super().__init__()
        self.item=nn.Embedding(sizes[0]+1,width,padding_idx=0)
        self.fields=nn.ModuleList(nn.Embedding(n+1,width) for n in sizes[1:])
        self.attention=nn.Sequential(nn.Linear(width*4,16),nn.ReLU(),nn.Linear(16,1))
        self.logit=nn.Sequential(nn.Linear(width*(len(sizes)+1),32),nn.ReLU(),nn.Linear(32,1))

    def forward(self, features, history):
        target=self.item(features[:,0])
        previous=self.item(history)
        expanded=target.unsqueeze(1).expand_as(previous)
        score=self.attention(torch.cat((expanded,previous,expanded-previous,expanded*previous),dim=-1)).squeeze(-1)
        weight=torch.softmax(score.masked_fill(history==0,-1e9),dim=1)*(history!=0)
        context=(weight.unsqueeze(-1)*previous).sum(dim=1)
        fields=[emb(features[:,i+1]) for i,emb in enumerate(self.fields)]
        return self.logit(torch.cat([target,context,*fields],dim=1)).squeeze(-1)


def evaluate(x,y,vx,vy,tx,ty,training,validation,test,vocabulary,fields,epochs,metrics,minimum):
    import copy
    index={element:i+1 for i,element in enumerate(vocabulary["element_id"])}
    def histories(views):
        rows=[]
        for view in views:
            for example in view["examples"]:
                seq=[index.get(v,0) for v in example.get("prior_elements",[])[-12:]]
                rows.append([0]*(12-len(seq))+seq)
        return torch.tensor(rows)
    if sum(any(any(v in index for v in e.get("prior_elements",[])) for e in view["examples"]) for view in training)<minimum:
        return {"status":"insufficient_history"}
    h,vh,th=map(histories,(training,validation,test))
    model=DIN([len(vocabulary[f]) for f in fields])
    optimizer=torch.optim.AdamW(model.parameters(),lr=0.003)
    best,state=float("inf"),None
    for _ in range(epochs):
        for batch in torch.randperm(len(y)).split(64):
            optimizer.zero_grad()
            loss=nn.functional.binary_cross_entropy_with_logits(model(x[batch],h[batch]),y[batch])
            loss.backward()
            optimizer.step()
        with torch.no_grad():
            score=nn.functional.binary_cross_entropy_with_logits(model(vx,vh),vy).item()
        if score<best:
            best,state=score,copy.deepcopy(model.state_dict())
    model.load_state_dict(state)
    with torch.no_grad():
        return {"status":"evaluated", "metrics":metrics(ty.tolist(),torch.sigmoid(model(tx,th)).tolist())}
